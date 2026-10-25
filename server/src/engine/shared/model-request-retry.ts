import { setTimeout as delay } from 'node:timers/promises';
import { FrameworkError } from './framework-error.js';

const RETRY_DELAYS_MS = [1_000, 3_000] as const;
const TRANSIENT_CODES = new Set([
  'MODEL_PROVIDER_UNREACHABLE', 'MODEL_RESPONSE_TIMEOUT', 'MODEL_RATE_LIMITED',
  'MODEL_PROVIDER_HTTP_408', 'MODEL_PROVIDER_HTTP_500', 'MODEL_PROVIDER_HTTP_502',
  'MODEL_PROVIDER_HTTP_503', 'MODEL_PROVIDER_HTTP_504', 'MODEL_PROVIDER_HTTP_529',
]);

/** Only the model request is retried. A tool executor never enters this boundary. */
export async function withModelRequestRetry<T>(options: {
  run: () => Promise<T>;
  signal?: AbortSignal;
  canRetry: () => boolean;
  delays?: readonly number[];
}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await options.run(); }
    catch (error) {
      if (options.signal?.aborted || !options.canRetry() || attempt >= delays.length
        || !(error instanceof FrameworkError) || !TRANSIENT_CODES.has(error.data.code)) throw error;
      const retryAfter = error.data.details?.retryAfterMs;
      const waitMs = typeof retryAfter === 'number' ? Math.max(delays[attempt], retryAfter) : delays[attempt];
      // Node timers cannot represent a longer wait. Do not retry earlier than the provider asked.
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 2_147_483_647) throw error;
      await delay(waitMs, undefined, { signal: options.signal });
    }
  }
}

export function modelRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}
