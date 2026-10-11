import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { compactMessages, type CompactionNotice, type CompactionOptions } from '../../../engine/shared/compaction/index.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { activeTideContext } from '../sessions/active-context.js';
import { tideTaskSessionDir } from '../sessions/session-paths.js';
import { readTideSession, writeTideSession } from '../sessions/session-store.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideScheduler } from '../runtime/scheduler.js';
import type { TideChangeFeed } from './change-feed.js';
import { ambiguousTideSession } from '../sessions/session-io.js';

export interface TideCompactionResult { compacted: boolean; notices: string[] }
export type SeasonCompaction = (agentId: string, sessionId: string,
  onNotice: (notice: CompactionNotice) => void) => Promise<void>;

/** Human-only lifecycle port; scheduled task prompts never invoke this command. */
export class TideSessionCompaction {
  constructor(private readonly dataDir: string, private readonly tasks: TideTaskRepository,
    private readonly scheduler: TideScheduler, private readonly changes?: TideChangeFeed,
    private readonly seasonCompaction?: SeasonCompaction,
    private readonly summaryPorts: Pick<CompactionOptions, 'summarize' | 'resolveSummaryBudget'> = {}) {}

  async compact(agentId: string, sessionId: string): Promise<TideCompactionResult> {
    const owners = (await this.tasks.read()).tasks.filter(item =>
      item.agentId === agentId && item.targetSessionId === sessionId);
    if (owners.length > 1 && owners.some(item => item.pushMode !== 'designated')) {
      throw ambiguousTideSession(sessionId);
    }
    const task = owners[0];
    if (!task) throw compactionError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found', '找不到绑定的潮汐会话');
    const result = await this.scheduler.exclusive(task.id, async () => {
      const notices: string[] = [];
      const onNotice = (notice: CompactionNotice) => { notices.push(notice.message); };
      if (task.pushMode === 'designated') {
        if (!this.seasonCompaction) throw compactionError('TIDE_SEASON_COMPACTION_UNAVAILABLE',
          'internal', '季风会话压缩接口未注册');
        await this.seasonCompaction(agentId, sessionId, onNotice);
      } else await this.compactOwn(task, sessionId, onNotice);
      this.changes?.publish({ scope: 'session', agentId, taskId: task.id, sessionId });
      return { compacted: true, notices };
    });
    if (!result) throw compactionError('TIDE_TASK_BUSY', 'conflict', '潮汐任务正在执行，暂不能压缩会话');
    return result;
  }

  private async compactOwn(task: { id: string; name: string; agentId: string }, sessionId: string,
    onNotice: (notice: CompactionNotice) => void): Promise<void> {
    const session = await readTideSession(this.dataDir, task.agentId, sessionId, task);
    if (!session) throw compactionError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found', '潮汐会话不存在');
    const agent = await loadAgent(this.dataDir, task.agentId);
    const plan = await compactMessages({ ...this.summaryPorts, dataDir: this.dataDir, area: 'tide',
      model: agent?.model ?? session.model, prompt: agent?.compactionPrompt, kind: 'conversation', protectedPrefixCount: 0,
      scopeKey: `tide:${task.agentId}:${sessionId}`, messages: activeTideContext(session.messages),
      mode: 'full', reason: 'manual', onNotice,
      archive: async (context, reason) => {
        const dir = path.join(tideTaskSessionDir(this.dataDir, task.agentId, task.id, task.name), 'compactions');
        await fs.mkdir(dir, { recursive: true });
        await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`),
          JSON.stringify({ reason, session, context }));
      },
      commit: async commit => {
        const timestamp = new Date().toISOString();
        const next = { ...session, updatedAt: timestamp, messages: [...session.messages,
          { id: `msg-${randomUUID()}`, role: 'system', content: commit.summary, timestamp,
            type: 'compact-marker' as const, contextExact: true, nativeContext: commit.messages }] };
        delete next.tokenUsage;
        if (next.usage) next.usage = { ...next.usage, latest: undefined };
        await writeTideSession(this.dataDir, next, task.id, task.name);
      } });
    if (!plan) throw compactionError('TIDE_COMPACTION_EMPTY', 'validation', '没有可压缩的会话内容');
  }
}

function compactionError(code: string, kind: 'not_found' | 'conflict' | 'internal' | 'validation', message: string) {
  return frameworkError({ code, kind, message, source: 'tide.compaction', retryable: false });
}
