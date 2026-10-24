import type { LLMCaller } from '../../shared/react/native-loop.js';

export const MEETING_IDLE_TIMEOUT_MS = 300_000;

export interface MeetingIdleGuard {
  signal: AbortSignal;
  touch(): void;
  pause(): void;
  resume(): void;
  timedOut(): boolean;
  dispose(): void;
}

export function createMeetingIdleGuard(parent?: AbortSignal, timeoutMs = MEETING_IDLE_TIMEOUT_MS): MeetingIdleGuard {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  let paused = false;
  let disposed = false;
  const reset = () => {
    if (controller.signal.aborted || paused || disposed) return;
    clearTimeout(timeout);
    timeout = setTimeout(() => { didTimeout = true; controller.abort(); }, timeoutMs);
  };
  const abort = () => {
    clearTimeout(timeout);
    controller.abort(parent?.reason);
  };
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  reset();
  return {
    signal: controller.signal,
    touch: reset,
    pause: () => { paused = true; clearTimeout(timeout); },
    resume: () => { paused = false; reset(); },
    timedOut: () => didTimeout,
    dispose: () => {
      disposed = true;
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    },
  };
}

/** Compaction owns its deadline; meeting silence is measured only after preparation. */
export function withMeetingIdleGuard(llm: LLMCaller, guard: MeetingIdleGuard): LLMCaller {
  return {
    prepare: async (...args) => { guard.pause(); await llm.prepare?.(...args); },
    recover: async (...args) => { guard.pause(); return await llm.recover?.(...args) ?? false; },
    call: (...args) => { guard.resume(); return llm.call(...args); },
  };
}
