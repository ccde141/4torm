import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { BeginConvectionRoundReceipt } from './round-commands.js';
import type { ConvectionEventSink } from './round-executor.js';

export interface PreparedConvectionRound {
  receipt: BeginConvectionRoundReceipt;
  run(onEvent?: ConvectionEventSink): Promise<void>;
  dispose(cause?: unknown): Promise<void>;
}

/** A lease owns both the prepared lock and the eventual running task. */
export class ConvectionPreparedRound implements PreparedConvectionRound {
  private state: 'prepared' | 'running' | 'settling' | 'disposed' = 'prepared';
  private disposal: Promise<void> | null = null;
  private settlementError: unknown;
  task: Promise<void> | null = null;

  constructor(
    readonly receipt: BeginConvectionRoundReceipt,
    private readonly execute: (onEvent: ConvectionEventSink) => Promise<void>,
    private readonly cancelPrepared: (cause?: unknown) => Promise<void>,
    private readonly abortRunning: () => Promise<unknown>,
    private readonly release: () => void,
    private readonly assertRunnable: () => void,
  ) {}

  run(onEvent: ConvectionEventSink = () => undefined): Promise<void> {
    if (this.state !== 'prepared') return Promise.reject(frameworkError({
      code: 'CONVECTION_ROUND_ALREADY_STARTED', kind: 'conflict',
      message: '对流轮次已经启动或释放', source: 'convection.round-service', retryable: false,
    }));
    try { this.assertRunnable(); } catch (error) { return Promise.reject(error); }
    this.state = 'running';
    this.task = Promise.resolve().then(() => this.execute(onEvent)).finally(() => {
      this.state = 'disposed';
      this.release();
    });
    return this.task;
  }

  async settle(commit: () => Promise<unknown>): Promise<void> {
    this.state = 'settling';
    try { await commit(); }
    catch (error) { this.settlementError = error; throw error; }
  }

  dispose(cause?: unknown): Promise<void> {
    if (this.disposal) return this.disposal;
    if (this.state === 'disposed') return Promise.resolve();
    if (this.state === 'prepared') {
      this.state = 'disposed';
      this.disposal = Promise.resolve().then(() => this.cancelPrepared(cause)).finally(this.release);
    } else {
      const abort = this.state === 'running';
      this.disposal = (async () => {
        try { if (abort) await this.abortRunning(); }
        finally { await this.task?.catch(() => undefined); }
        if (this.settlementError !== undefined) throw this.settlementError;
      })();
    }
    return this.disposal;
  }
}
