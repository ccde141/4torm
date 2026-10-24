import { CompactionRequestTimeout } from './request-deadline.js';

export const AUTOMATIC_COMPACTION_TIMEOUT_MS = 2 * 60 * 60_000;

/** All fragments and merge stages share one automatic-compaction budget. */
export function automaticCompactionDeadline(parent?: AbortSignal): {
  signal: AbortSignal; dispose(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(() => controller.abort(new CompactionRequestTimeout(
    '自动压缩超时（2 小时），原会话与已完成片段保留；可重新压缩接续',
  )), AUTOMATIC_COMPACTION_TIMEOUT_MS);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  } };
}
