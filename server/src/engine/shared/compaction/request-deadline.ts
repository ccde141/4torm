/** The summarization job may span many requests; each request owns its own deadline. */
export class CompactionRequestTimeout extends Error {}

export function compactionRequestDeadline(signal?: AbortSignal,
  limits = { totalMs: 15 * 60_000, idleMs: 3 * 60_000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timeout = (message: string) => controller.abort(new CompactionRequestTimeout(message));
  const total = setTimeout(() => timeout('压缩片段生成超时，已完成片段已保留；可重新压缩接续'), limits.totalMs);
  let idle: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => timeout('压缩模型长时间未响应，已完成片段已保留；可重新压缩接续'), limits.idleMs);
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  touch();
  return { signal: controller.signal, touch, dispose: () => {
    clearTimeout(total); clearTimeout(idle);
    signal?.removeEventListener('abort', abort);
  } };
}
