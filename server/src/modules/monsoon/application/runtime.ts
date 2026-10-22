import { FrameworkError, frameworkError } from '../../../engine/shared/framework-error.js';
import {
  MonsoonSessionRegistry, type MonsoonRuntimeSnapshot, type SessionLeaseFactory,
} from '../runtime/session-registry.js';
import { MonsoonRunnerAdapter } from '../runtime/runner-adapter.js';
import type { MonsoonTurn, MonsoonTurnSpec } from '../runtime/turn-contract.js';
import { createHash } from 'node:crypto';
import type { ProbeItem, ProbeStatus } from '../../../shared/probes/public.js';
import type { MonsoonRunRecord } from '../domain/run-record.js';
import type { MonsoonRunRepository } from '../infrastructure/run-repository.js';
import { OperationNotifier } from '../../../engine/collaboration/operation-notifier.js';

export class MonsoonRuntime {
  private readonly sessions: MonsoonSessionRegistry;
  private readonly records = new Map<string, MonsoonRunRecord>();
  private readonly notifier = new OperationNotifier();
  private readonly preparing = new Set<Promise<unknown>>();
  private readonly executing = new Set<Promise<void>>();
  private stopping = false;
  private shutdownTask?: Promise<void>;

  constructor(
    private readonly repository: MonsoonRunRepository,
    acquireLease: SessionLeaseFactory,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly adapter = new MonsoonRunnerAdapter(),
  ) { this.sessions = new MonsoonSessionRegistry(acquireLease); }

  async initialize(): Promise<number> {
    const recovered = await this.repository.recover(this.clock());
    this.records.clear();
    for (const record of recovered.records) this.records.set(record.sessionId, record);
    return recovered.crashed;
  }

  async prepare(sessionId: string, spec: MonsoonTurnSpec): Promise<MonsoonTurn> {
    this.assertAccepting();
    const pending = this.prepareRunner(sessionId, spec);
    this.preparing.add(pending);
    try { return await pending; }
    finally { this.preparing.delete(pending); }
  }

  private async prepareRunner(sessionId: string, spec: MonsoonTurnSpec): Promise<MonsoonTurn> {
    const runner = this.sessions.reserve(sessionId, spec.agentId, () => this.adapter.create(spec));
    if (!runner) throw frameworkError({ code: 'MONSOON_SESSION_BUSY', kind: 'conflict',
      message: '会话正在执行中', source: 'monsoon.runtime', retryable: false });
    try {
      await this.adapter.ready(runner);
      this.assertAccepting();
      return runner;
    } catch (error) {
      this.sessions.clear(sessionId, runner);
      throw error;
    }
  }

  get(sessionId: string): MonsoonTurn | undefined {
    return this.sessions.get(sessionId) as MonsoonTurn | undefined;
  }

  getWaitingRunId(sessionId: string, runner: MonsoonTurn): string | undefined {
    if (this.sessions.get(sessionId) !== runner) return undefined;
    const record = this.records.get(sessionId);
    return record?.status === 'waiting' ? record.runId : undefined;
  }

  claimResume(sessionId: string, runner: MonsoonTurn): boolean {
    if (this.stopping) return false;
    return this.sessions.claimResume(sessionId, runner);
  }

  async markRunning(sessionId: string, runner: MonsoonTurn, runId: string): Promise<void> {
    await this.store(recordFor(sessionId, runId, runner.getAgentId(), 'running', 'streaming', this.clock()));
    this.sessions.markRunning(sessionId, runner);
  }

  async complete(
    sessionId: string, runner: MonsoonTurn, runId: string,
    status: 'completed' | 'aborted' | 'waiting',
  ): Promise<void> {
    await this.store(recordFor(sessionId, runId, runner.getAgentId(), status, status, this.clock()));
    if (status === 'waiting') this.sessions.markWaiting(sessionId, runner);
    else this.sessions.clear(sessionId, runner);
  }

  async fail(
    sessionId: string, runner: MonsoonTurn, runId?: string,
    failure?: { code?: string; message?: string },
  ): Promise<void> {
    try {
      if (runId) await this.store({
        ...recordFor(sessionId, runId, runner.getAgentId(), 'failed', 'failed', this.clock()),
        ...(failure?.code ? { errorCode: failure.code } : {}),
        ...(failure?.message ? { errorMessage: failure.message } : {}),
      });
    } finally { this.sessions.clear(sessionId, runner); }
  }

  async abort(sessionId: string, expectedRunId?: string): Promise<boolean> {
    const current = this.records.get(sessionId);
    if (expectedRunId && current?.runId !== expectedRunId) {
      throw frameworkError({
        code: 'MONSOON_RUN_MISMATCH', kind: 'conflict',
        message: '目标执行已经被更新', source: 'monsoon.runtime', retryable: false,
      });
    }
    const runner = this.get(sessionId);
    const teamStopped = this.adapter.stopTeam(sessionId);
    if (!runner) return teamStopped;
    const wasSuspended = runner.isSuspended();
    runner.abort();
    if (wasSuspended) {
      const prior = this.records.get(sessionId);
      if (prior) await this.store({ ...prior, status: 'aborted', phase: 'aborted', updatedAt: this.clock() });
      this.sessions.clear(sessionId, runner);
    }
    return true;
  }

  snapshot(): MonsoonRuntimeSnapshot {
    const active = this.sessions.snapshot().items;
    const items = new Map<string, ProbeItem>([...this.records.values()].map(record => [record.sessionId, {
      operationId: record.sessionId, runId: record.runId, agentId: record.agentId,
      title: record.sessionId, status: record.status, phase: record.phase,
      updatedAt: record.updatedAt, errorCode: record.errorCode, errorMessage: record.errorMessage,
    }] as const));
    for (const item of active) {
      const record = this.records.get(item.operationId);
      items.set(item.operationId, { ...item, ...(record ? { runId: record.runId } : {}) });
    }
    const ordered = [...items.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
    const revision = createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 16);
    return { revision, items: ordered };
  }

  findRun(sessionId: string, runId: string): ProbeItem | undefined {
    const item = this.snapshot().items.find(candidate =>
      candidate.operationId === sessionId && candidate.runId === runId);
    return item ? structuredClone(item) : undefined;
  }

  subscribeRun(sessionId: string, runId: string, listener: () => void): () => void {
    return this.notifier.subscribe({ operationId: sessionId, runId }, listener);
  }

  isStopping(): boolean { return this.stopping; }

  /** Covers context compilation and journal admission as well as runner readiness. */
  async trackPreparation<T>(work: () => Promise<T>): Promise<T> {
    this.assertAccepting();
    const pending = Promise.resolve().then(() => { this.assertAccepting(); return work(); });
    this.preparing.add(pending);
    try { return await pending; }
    finally { this.preparing.delete(pending); }
  }

  /** The completion includes event journals and terminal persistence, not just model output. */
  async trackExecution(work: () => Promise<void>): Promise<void> {
    this.assertAccepting();
    const pending = Promise.resolve().then(work);
    this.executing.add(pending);
    // Observe rejection on the cleanup branch without replacing the caller's rejected promise.
    void pending.then(() => this.executing.delete(pending), () => this.executing.delete(pending));
    return pending;
  }

  shutdown(): Promise<void> {
    if (!this.shutdownTask) {
      this.stopping = true;
      this.shutdownTask = Promise.resolve().then(() => this.drainShutdown());
    }
    return this.shutdownTask;
  }

  private async drainShutdown(): Promise<void> {
    const errors: unknown[] = [];
    const preparations = Promise.allSettled([...this.preparing]);
    const executions = Promise.allSettled([...this.executing]);
    try { this.sessions.shutdown(); } catch (error) { errors.push(error); }
    try { await this.adapter.shutdown(); } catch (error) { errors.push(error); }
    for (const result of [...await preparations, ...await executions]) {
      if (result.status === 'rejected' && !(result.reason instanceof FrameworkError
        && result.reason.data.code === 'MONSOON_RUNTIME_CLOSING')) errors.push(result.reason);
    }
    if (errors.length) throw new AggregateError(errors, '季风模块关闭失败');
  }

  private assertAccepting(): void {
    if (this.stopping) throw frameworkError({
      code: 'MONSOON_RUNTIME_CLOSING', kind: 'conflict', message: '季风模块正在关闭',
      source: 'monsoon.runtime', retryable: false,
    });
  }

  private async store(record: MonsoonRunRecord): Promise<void> {
    await this.repository.save(record);
    this.records.set(record.sessionId, record);
    this.notifier.publish({ operationId: record.sessionId, runId: record.runId });
  }
}

function recordFor(
  sessionId: string, runId: string, agentId: string,
  status: ProbeStatus, phase: string, updatedAt: string,
): MonsoonRunRecord {
  return { schemaVersion: 1, sessionId, runId, agentId, status, phase, updatedAt };
}
