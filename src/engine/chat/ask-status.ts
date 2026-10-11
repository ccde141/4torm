import type { RunProbe } from './run-reconciliation';

export type AskStatus = 'checking' | 'waiting' | 'submitting' | 'accepted'
  | 'failed' | 'unknown' | 'expired';

export function classifyAskRun(
  sourceRunId: string,
  current: Pick<RunProbe, 'runId' | 'status'> | null,
): AskStatus {
  if (!current || current.runId !== sourceRunId) return 'expired';
  if (current.status === 'waiting') return 'waiting';
  if (current.status === 'running' || current.status === 'queued') return 'checking';
  return 'expired';
}

export function mayApplyAskSnapshot(
  requested: { sessionId: string; messages: readonly unknown[]; sequence: number },
  current: { sessionId: string | null; messages: readonly unknown[];
    sequence: number; busy: boolean },
): boolean {
  return requested.sessionId === current.sessionId
    && requested.messages === current.messages
    && requested.sequence === current.sequence && !current.busy;
}
