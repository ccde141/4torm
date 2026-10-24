import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { compactMessages, type CompactionNotice, type CompactionOptions,
  type CompactionProgress } from '../../../engine/shared/compaction/index.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { activeTideContext } from '../sessions/active-context.js';
import { tideTaskSessionDir } from '../sessions/session-paths.js';
import { readTideSession } from '../sessions/session-store.js';
import { commitTideCompaction } from '../sessions/compaction-store.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideScheduler } from '../runtime/scheduler.js';
import type { TideChangeFeed } from './change-feed.js';
import { ambiguousTideSession } from '../sessions/session-io.js';
import { parseTideCompactionProgress } from '../domain/compaction-progress.js';
import { observeModelRequests, recordModelRequest, type ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';

const activeCompactions = new Set<string>();
function compactionKey(dataDir: string, agentId: string, sessionId: string) {
  return JSON.stringify([path.resolve(dataDir), agentId, sessionId]);
}
export function isTideSessionCompacting(dataDir: string, agentId: string, sessionId: string): boolean {
  return activeCompactions.has(compactionKey(dataDir, agentId, sessionId));
}

export interface TideCompactionResult { compacted: boolean; notices: string[]; updatedAt: number }
export type SeasonCompaction = (agentId: string, sessionId: string,
  onNotice: (notice: CompactionNotice) => void, signal?: AbortSignal) => Promise<void>;

/** Human-only lifecycle port; scheduled task prompts never invoke this command. */
export class TideSessionCompaction {
  constructor(private readonly dataDir: string, private readonly tasks: TideTaskRepository,
    private readonly scheduler: TideScheduler, private readonly changes?: TideChangeFeed,
    private readonly seasonCompaction?: SeasonCompaction,
    private readonly summaryPorts: Pick<CompactionOptions, 'summarize' | 'resolveSummaryBudget'> = {}) {}

  async compact(agentId: string, sessionId: string, signal?: AbortSignal): Promise<TideCompactionResult> {
    signal?.throwIfAborted();
    const owners = (await this.tasks.read()).tasks.filter(item =>
      item.agentId === agentId && item.targetSessionId === sessionId);
    if (owners.length > 1 && owners.some(item => item.pushMode !== 'designated')) {
      throw ambiguousTideSession(sessionId);
    }
    const task = owners[0];
    if (!task) throw compactionError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found', '找不到绑定的潮汐会话');
    const result = await this.scheduler.exclusive(task.id, async () => {
      signal?.throwIfAborted();
      const key = compactionKey(this.dataDir, agentId, sessionId);
      activeCompactions.add(key);
      try {
        const notices: string[] = [];
        const onNotice = (notice: CompactionNotice) => { notices.push(notice.message); };
        if (task.pushMode === 'designated') {
          if (!this.seasonCompaction) throw compactionError('TIDE_SEASON_COMPACTION_UNAVAILABLE',
            'internal', '季风会话压缩接口未注册');
          await this.seasonCompaction(agentId, sessionId, onNotice, signal);
        } else await this.compactOwn(task, sessionId, onNotice, signal);
        this.changes?.publish({ scope: 'session', agentId, taskId: task.id, sessionId });
        return { compacted: true, notices, updatedAt: Date.now() };
      } finally { activeCompactions.delete(key); }
    });
    if (!result) throw compactionError('TIDE_TASK_BUSY', 'conflict', '潮汐任务正在执行，暂不能压缩会话');
    return result;
  }

  private async compactOwn(task: { id: string; name: string; agentId: string }, sessionId: string,
    onNotice: (notice: CompactionNotice) => void, signal?: AbortSignal): Promise<void> {
    const session = await readTideSession(this.dataDir, task.agentId, sessionId, task);
    if (!session) throw compactionError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found', '潮汐会话不存在');
    const agent = await loadAgent(this.dataDir, task.agentId);
    let current = session;
    let progress: CompactionProgress | undefined;
    let lifecycleError: unknown;
    let writes = Promise.resolve();
    const recordUsage = (event: ModelRequestUsageEvent) => {
      const usage = current.usage ?? { calls: 0, reportedCalls: 0 };
      current = { ...current, usage: { ...usage, modelUsage: recordModelRequest(usage.modelUsage, event.request) } };
      writes = writes.then(async () => {
        const snapshot = current;
        await commitTideCompaction(this.dataDir, task, snapshot, snapshot);
        this.changes?.publish({ scope: 'session', agentId: task.agentId, taskId: task.id, sessionId });
      });
      void writes.catch(() => undefined);
    };
    const plan = await observeModelRequests(recordUsage, async () => {
      try { return await compactMessages({ ...this.summaryPorts, dataDir: this.dataDir, area: 'tide',
      model: agent?.model ?? session.model, prompt: agent?.compactionPrompt, kind: 'conversation', protectedPrefixCount: 0,
      scopeKey: `tide:${task.agentId}:${sessionId}`, messages: activeTideContext(session.messages),
      mode: 'full', reason: 'manual', onNotice, signal,
      onProgress: async event => {
        await writes;
        progress = parseTideCompactionProgress(event);
        if (event.type !== 'compact-done') {
          const next = { ...current, compaction: progress };
          try { await commitTideCompaction(this.dataDir, task, current, next,
            event.type === 'compact-start' ? signal : undefined); }
          catch (error) { lifecycleError = error; throw error; }
          current = next;
        }
        this.changes?.publish({ scope: 'session', agentId: task.agentId, taskId: task.id, sessionId });
      },
      archive: async (context, reason) => {
        if (lifecycleError) throw lifecycleError;
        const dir = path.join(tideTaskSessionDir(this.dataDir, task.agentId, task.id, task.name), 'compactions');
        await fs.mkdir(dir, { recursive: true });
        await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`),
          JSON.stringify({ reason, session, context }));
      },
      commit: async (commit, commitSignal) => {
        await writes;
        const timestamp = new Date().toISOString();
        const next = { ...current, updatedAt: timestamp, compaction: { ...progress!, type: 'compact-done' as const,
          updatedAt: Date.now(), summaryLength: commit.summary.length, archivedMessages: commit.prefix.length },
          messages: [...current.messages,
          { id: `msg-${randomUUID()}`, role: 'system', content: commit.summary, timestamp,
            type: 'compact-marker' as const, contextExact: true, nativeContext: commit.messages }] };
        delete next.tokenUsage;
        if (next.usage) next.usage = { ...next.usage, latest: undefined };
        await commitTideCompaction(this.dataDir, task, current, next, commitSignal);
        current = next;
      } }); } finally { await writes; }
    });
    if (!plan) throw compactionError('TIDE_COMPACTION_EMPTY', 'validation', '没有可压缩的会话内容');
  }
}

function compactionError(code: string, kind: 'not_found' | 'conflict' | 'internal' | 'validation', message: string) {
  return frameworkError({ code, kind, message, source: 'tide.compaction', retryable: false });
}
