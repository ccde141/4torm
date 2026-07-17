export const MEETING_IDLE_TIMEOUT_MS = 300_000;

export interface MeetingIdleGuard {
  signal: AbortSignal;
  touch(): void;
  timedOut(): boolean;
  dispose(): void;
}

export function createMeetingIdleGuard(parent?: AbortSignal, timeoutMs = MEETING_IDLE_TIMEOUT_MS): MeetingIdleGuard {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  const reset = () => {
    if (controller.signal.aborted) return;
    clearTimeout(timeout);
    timeout = setTimeout(() => { didTimeout = true; controller.abort(); }, timeoutMs);
  };
  const abort = () => {
    clearTimeout(timeout);
    controller.abort();
  };
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  reset();
  return {
    signal: controller.signal,
    touch: reset,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    },
  };
}
