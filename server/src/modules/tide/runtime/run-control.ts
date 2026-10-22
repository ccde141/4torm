import { frameworkError, FrameworkError } from '../../../engine/shared/framework-error.js';
import type { TideRunStatus } from '../domain/run-state.js';

export interface TideRunAbortReceipt {
  taskId: string;
  runId: string;
  accepted: boolean;
  status: TideRunStatus | 'aborting';
  reason?: 'saving' | 'already_requested';
}

/** A single execution owns cancellation until it enters its final persistence step. */
export class TideRunControl {
  private readonly controller = new AbortController();
  private saving = false;

  constructor(readonly taskId: string, readonly runId: string) {}

  get signal(): AbortSignal { return this.controller.signal; }

  abort(): TideRunAbortReceipt {
    const identity = { taskId: this.taskId, runId: this.runId };
    if (this.saving) return { ...identity, accepted: false, status: 'running', reason: 'saving' };
    if (this.signal.aborted) {
      return { ...identity, accepted: false, status: 'aborting', reason: 'already_requested' };
    }
    this.controller.abort(frameworkError({ code: 'TIDE_RUN_ABORTED', kind: 'cancelled',
      message: '本轮潮汐执行已中止', source: 'tide.run-control', retryable: false }));
    return { ...identity, accepted: true, status: 'aborting' };
  }

  beginCommit(): void {
    this.signal.throwIfAborted();
    this.seal();
  }

  seal(): void {
    this.saving = true;
  }
}

export function isTideRunAborted(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TIDE_RUN_ABORTED';
}
