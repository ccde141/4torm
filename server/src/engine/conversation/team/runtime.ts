import type { ContextMessage } from '../../shared/types.js';
import { TeamStore } from './store.js';
import type { TeamMember, TeamPermissions } from './types.js';

export type MemberExecutor = (member: TeamMember, task: string,
  checkpoint: (context: ContextMessage[]) => Promise<void>, signal: AbortSignal) => Promise<string>;

/** Owns live executions only. TeamStore remains the durable source of truth. */
export class TeamRuntime {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly failures: unknown[] = [];
  private stopVersion = 0;
  constructor(readonly store: TeamStore, private execute: MemberExecutor) {}
  configure(execute: MemberExecutor): void { this.execute = execute; }

  async dispatch(memberId: string, task: string, policy: TeamPermissions, requestId?: string) {
    const version = this.stopVersion;
    const run = await this.store.start(memberId, task, policy, requestId);
    if (run.replayed) return run;
    const controller = new AbortController();
    if (version !== this.stopVersion) controller.abort();
    const done = this.perform(memberId, run.id, task, controller.signal, this.execute);
    this.active.set(run.id, { controller, done });
    void done.catch(error => {
      this.failures.push(error);
      console.error('[conversation.team] Failed to persist execution outcome', error);
    }).finally(() => this.active.delete(run.id));
    return run;
  }

  private async perform(memberId: string, runId: string, task: string, signal: AbortSignal, execute: MemberExecutor): Promise<void> {
    let content: string;
    let outcome: 'completed' | 'failed' | 'aborted' = 'completed';
    try {
      const member = (await this.store.read()).members.find(item => item.id === memberId)!;
      content = await execute(member, task, context => this.store.checkpoint(memberId, runId, context), signal);
      if (signal.aborted) outcome = 'aborted';
    } catch (error) {
      outcome = signal.aborted ? 'aborted' : 'failed';
      content = error instanceof Error ? error.message : String(error);
    }
    await this.store.finish(memberId, runId, outcome, content);
  }

  stop(): void {
    this.stopVersion++;
    for (const run of this.active.values()) run.controller.abort();
  }
  isActive(): boolean { return this.active.size > 0; }
  async waitForProgress(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const boundary = new Promise<void>(resolve => {
      timer = setTimeout(resolve, 1000);
      cancel = resolve;
      signal?.addEventListener('abort', cancel, { once: true });
    });
    try { await Promise.race([...this.active.values()].map(run => run.done).concat(boundary)); }
    finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  }
  async waitBriefly(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('TEAM_WAIT_ABORTED');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const boundary = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(resolve, 30_000);
      cancel = () => reject(new Error('TEAM_WAIT_ABORTED'));
      signal?.addEventListener('abort', cancel, { once: true });
    });
    try { await Promise.race([this.wait(), boundary]); }
    finally {
      if (timeout) clearTimeout(timeout);
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  }
  async wait(): Promise<void> {
    await Promise.all([...this.active.values()].map(run => run.done));
    if (this.failures.length) throw this.failures[0];
  }
}
