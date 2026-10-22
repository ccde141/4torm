import type { TideRunRecord } from '../../api/tide';

export interface TideRunSessionTarget {
  agentId: string;
  sessionId: string;
}

export function tideRunSessionTarget(
  run: TideRunRecord, fallbackAgentId: string,
): TideRunSessionTarget | null {
  if (!run.sessionId || run.sessionState === 'archived') return null;
  return { agentId: run.agentId ?? fallbackAgentId, sessionId: run.sessionId };
}
