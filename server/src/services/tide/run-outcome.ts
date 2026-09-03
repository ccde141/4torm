import { FrameworkError } from '../../engine/shared/framework-error.js';

export function assertTideRunNotTimedOut(timedOut: boolean, timeoutMs: number): void {
  if (!timedOut) return;
  throw new FrameworkError({
    code: 'TIDE_RUN_TIMEOUT', kind: 'timeout',
    message: `潮汐任务执行超时（${timeoutMs / 1000}s）`,
    source: 'tide.runner', retryable: false,
  });
}
