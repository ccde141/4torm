import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { createCompactionCaller, type CompactionCommit, type CompactionOptions, type CompactionProgress } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { LLMCaller } from '../../../engine/shared/react/native-loop.js';
import { requireSeasonSessionPort } from '../sessions/season-session-port.js';
import type { TideTask } from '../domain/task.js';
import type { ResolvedTarget } from '../sessions/session-resolver.js';
import type { TideSession } from '../sessions/session-types.js';
import { commitTideCompaction } from '../sessions/compaction-store.js';
import { tideTaskSessionDir } from '../sessions/session-paths.js';

export class TideContextCompaction {
  flushUsage: () => Promise<unknown> = async () => undefined;
  private changed = false;
  private progress?: CompactionProgress;
  readonly notices: string[] = [];
  constructor(private readonly dataDir: string, private readonly task: TideTask,
    private readonly resolved: ResolvedTarget, private readonly base: TideSession,
    private readonly prompt?: string, private readonly initialEstimateTokens?: number,
    private readonly onNotice?: (message: string) => Promise<void>,
    private readonly summaryPorts: Pick<CompactionOptions, 'summarize' | 'resolveSummaryBudget'> = {},
    private readonly onProgress?: (event: CompactionProgress, sessionId: string, revision?: number) => Promise<void>) {}

  transform(llm: LLMCaller): LLMCaller {
    const caller = createCompactionCaller({ ...this.summaryPorts, llm, dataDir: this.dataDir,
      area: this.task.pushMode === 'designated' ? 'monsoon' : 'tide',
      model: this.base.model, kind: 'conversation',
      protectedPrefixCount: 1, prompt: this.prompt,
      scopeKey: `tide:${this.task.agentId}:${this.resolved.sessionId}`,
      // Own Tide history can be trimmed by rolling retention between runs. The
      // last provider measurement remains a display fact, not a new-context anchor.
      initialPromptTokens: this.task.pushMode === 'designated'
        ? this.resolved.existing?.tokenUsage?.promptTokens : undefined,
      initialEstimateTokens: this.initialEstimateTokens,
      archive: (before, reason) => this.archive(before, reason),
      commit: (plan, signal) => this.commit(plan, signal),
      onProgress: async event => { this.progress = event;
        await this.onProgress?.(event, this.resolved.sessionId, this.resolved.existing?.revision); },
      onNotice: async notice => { this.notices.push(notice.message);
        await this.onNotice?.(notice.message); },
    });
    return { call: async (...args) => { await this.flushUsage(); return caller.call(...args); } };
  }

  async checkpoint(messages: ContextMessage[]): Promise<void> {
    await this.flushUsage();
    if (this.changed) this.resolved.compactedContext = structuredClone(messages.slice(1));
  }

  private async archive(before: ContextMessage[], reason: CompactionCommit['reason']): Promise<void> {
    if (this.task.pushMode === 'designated') {
      return requireSeasonSessionPort(this.resolved.seasonSessions).archive(this.task.agentId,
        this.resolved.sessionId, before, reason);
    }
    const dir = path.join(tideTaskSessionDir(this.dataDir, this.task.agentId, this.task.id, this.task.name), 'compactions');
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`),
      JSON.stringify({ reason, session: this.resolved.existing, context: before }));
  }

  private async commit(plan: CompactionCommit, signal?: AbortSignal): Promise<void> {
    await this.flushUsage();
    signal?.throwIfAborted();
    if (this.task.pushMode === 'designated') {
      const revision = this.resolved.existing?.revision;
      if (revision === undefined) throw new Error('指定季风会话缺少版本');
      this.resolved.existing = await requireSeasonSessionPort(this.resolved.seasonSessions).commitCompaction(
        this.task.agentId, this.resolved.sessionId, revision, plan, signal);
    } else {
      const next = { ...(this.resolved.existing ?? this.base),
        messages: [...(this.resolved.existing ?? this.base).messages,
          { id: `msg-${randomUUID()}`, role: 'system', content: plan.summary,
            type: 'compact-marker' as const, contextExact: true,
            compactionId: this.progress?.id,
            nativeContext: structuredClone(plan.messages.slice(1)), timestamp: new Date().toISOString() }],
        updatedAt: new Date().toISOString() };
      delete next.tokenUsage;
      await commitTideCompaction(this.dataDir, this.task, this.resolved.existing ?? this.base, next, signal);
      this.resolved.existing = next;
    }
    this.resolved.compactedContext = structuredClone(plan.messages.slice(1));
    this.changed = true;
  }
}
