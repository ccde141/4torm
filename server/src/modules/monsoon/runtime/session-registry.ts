import { createHash } from 'node:crypto';
import type { MonsoonTurn } from './turn-contract.js';
import type { ObservationItem } from '../../../engine/collaboration/contracts.js';

export type MonsoonRunnerHandle = Pick<MonsoonTurn,
  'isBusy' | 'isSuspended' | 'getAgentId' | 'getInputRuntime' | 'abort'>;
export type SessionLeaseFactory = (agentId: string, sessionId: string) => (() => void) | null;

interface RegistryEntry {
  runner: MonsoonRunnerHandle;
  phase: 'preparing' | 'streaming' | 'human-input';
  release: () => void;
  updatedAt: string;
}

export interface MonsoonRuntimeSnapshot {
  revision: string;
  items: ObservationItem[];
}

export class MonsoonSessionRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(private readonly acquireLease: SessionLeaseFactory) {}

  get(sessionId: string): MonsoonRunnerHandle | undefined {
    return this.entries.get(sessionId)?.runner;
  }

  reserve<T extends MonsoonRunnerHandle>(
    sessionId: string, agentId: string, create: () => T,
  ): T | null {
    if (this.entries.has(sessionId)) return null;
    const release = this.acquireLease(agentId, sessionId);
    if (!release) return null;
    try {
      const runner = create();
      this.entries.set(sessionId, { runner, phase: 'preparing', release, updatedAt: now() });
      return runner;
    } catch (error) {
      release();
      throw error;
    }
  }

  claimResume(sessionId: string, runner: MonsoonRunnerHandle): boolean {
    const entry = this.entries.get(sessionId);
    if (entry?.runner !== runner || entry.phase !== 'human-input'
      || !runner.isSuspended() || runner.isBusy()) return false;
    this.mark(sessionId, runner, 'streaming');
    return true;
  }

  markRunning(sessionId: string, runner: MonsoonRunnerHandle): void {
    this.mark(sessionId, runner, 'streaming');
  }

  markWaiting(sessionId: string, runner: MonsoonRunnerHandle): void {
    this.mark(sessionId, runner, 'human-input');
  }

  clear(sessionId: string, runner: MonsoonRunnerHandle): void {
    const entry = this.entries.get(sessionId);
    if (entry?.runner !== runner) return;
    this.entries.delete(sessionId);
    entry.release();
  }

  snapshot(): MonsoonRuntimeSnapshot {
    const items = [...this.entries.entries()].map(([sessionId, entry]) => ({
      operationId: sessionId,
      agentId: entry.runner.getAgentId(),
      title: sessionId,
      status: entry.phase === 'human-input' ? 'waiting' as const
        : entry.phase === 'streaming' ? 'running' as const : 'queued' as const,
      phase: entry.phase,
      updatedAt: entry.updatedAt,
    })).sort((left, right) => left.operationId.localeCompare(right.operationId));
    const revision = createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16);
    return { revision, items };
  }

  shutdown(): void {
    const entries = [...this.entries.entries()];
    const errors: unknown[] = [];
    for (const [sessionId, entry] of entries) {
      try {
        entry.runner.abort();
      } catch (error) {
        errors.push(error);
      } finally {
        this.clear(sessionId, entry.runner);
      }
    }
    if (errors.length) throw new AggregateError(errors, '季风运行时关闭失败');
  }

  private mark(
    sessionId: string,
    runner: MonsoonRunnerHandle,
    phase: RegistryEntry['phase'],
  ): void {
    const entry = this.entries.get(sessionId);
    if (entry?.runner !== runner) return;
    entry.phase = phase;
    entry.updatedAt = now();
  }
}

function now(): string {
  return new Date().toISOString();
}
