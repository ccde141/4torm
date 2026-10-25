import { frameworkError } from '../../engine/shared/framework-error.js';

export const DEFAULT_MODEL_RESPONSE_WAIT_MINUTES = 30;

export function validResponseWaitMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    && value <= Math.floor(Number.MAX_SAFE_INTEGER / 60_000);
}

export function resolveModelResponseWait(settings: unknown, model: string): number {
  if (settings === undefined || settings === null) return DEFAULT_MODEL_RESPONSE_WAIT_MINUTES * 60_000;
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('模型无响应等待设置无效');
  const minutes = Object.hasOwn(settings, model) ? (settings as Record<string, unknown>)[model] : undefined;
  if (minutes === undefined) return DEFAULT_MODEL_RESPONSE_WAIT_MINUTES * 60_000;
  if (!validResponseWaitMinutes(minutes)) throw new Error('模型无响应等待时间必须是正整数分钟');
  return minutes * 60_000;
}

/** Starts after acquiring the provider slot; only model output renews the wait. */
export async function withModelResponseWait<T>(parent: AbortSignal | undefined, waitMs: number,
  run: (signal: AbortSignal, touch: () => void) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = 0;
  let expired = false;
  const check = () => {
    const remaining = expiresAt - Date.now();
    if (remaining > 0) { timer = setTimeout(check, Math.min(remaining, 2_147_483_647)); return; }
    expired = true;
    controller.abort(frameworkError({ code: 'MODEL_RESPONSE_TIMEOUT', kind: 'timeout',
      message: `模型连续 ${waitMs / 60_000} 分钟未返回响应，可在模型设置中增加等待时间`,
      source: 'model-runtime.response-wait', retryable: false }));
  };
  const touch = () => {
    if (controller.signal.aborted) return;
    clearTimeout(timer);
    expiresAt = Date.now() + waitMs;
    timer = setTimeout(check, Math.min(waitMs, 2_147_483_647));
  };
  const abort = () => { clearTimeout(timer); controller.abort(parent?.reason); };
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort(); else touch();
  try {
    controller.signal.throwIfAborted();
    const result = await run(controller.signal, touch);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (expired) throw controller.signal.reason;
    throw error;
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
