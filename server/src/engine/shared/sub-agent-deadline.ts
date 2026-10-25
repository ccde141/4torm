import type { SubAgentEvent, SubAgentResult } from './sub-agent-types.js';

export const SUB_AGENT_MAX_DURATION_MS = 60 * 60 * 1000;

interface DeadlineOptions {
  signal: AbortSignal;
  timeout?: number;
  emit?: (event: SubAgentEvent) => void;
}

type Execution = (signal: AbortSignal, emit: (event: SubAgentEvent) => void) => Promise<SubAgentResult>;

/** A short-lived delegation owns one deadline across setup, model calls and tools. */
export async function withSubAgentDeadline(options: DeadlineOptions, execute: Execution): Promise<SubAgentResult> {
  const timeout = options.timeout ?? SUB_AGENT_MAX_DURATION_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('SubAgent timeout 必须为正数毫秒');
  const controller = new AbortController();
  let rounds = 0;
  let finished = false;
  let stopResult: SubAgentResult | undefined;
  let resolveStop!: (result: SubAgentResult) => void;
  const stopped = new Promise<SubAgentResult>(resolve => { resolveStop = resolve; });
  const stop = (status: 'timeout' | 'aborted') => {
    if (finished || stopResult) return;
    stopResult = { status, rounds, summary: status === 'timeout'
      ? 'SubAgent 已达到本次委托的执行时限，已发出中止信号。'
      : 'SubAgent 被外部中止' };
    controller.abort(status === 'timeout' ? new Error('SubAgent execution timed out') : options.signal.reason);
    resolveStop(stopResult);
  };
  const onAbort = () => stop('aborted');
  options.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop('timeout'), Math.min(timeout, SUB_AGENT_MAX_DURATION_MS));
  if (options.signal.aborted) onAbort();
  const emit = (event: SubAgentEvent) => {
    if (finished || controller.signal.aborted || event.type === 'done' || event.type === 'error') return;
    if (event.type === 'tool_call') rounds++;
    options.emit?.(event);
  };
  let result: SubAgentResult;
  try {
    result = stopResult ?? await Promise.race([
      execute(controller.signal, emit).catch((cause: unknown): SubAgentResult => ({
        status: 'error', summary: 'SubAgent 执行失败', rounds,
        error: cause instanceof Error ? cause.message : String(cause),
      })),
      stopped,
    ]);
    result = stopResult ?? result;
  } finally {
    finished = true;
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
  options.emit?.({ type: result.status === 'error' ? 'error' : 'done', data: result });
  return result;
}
