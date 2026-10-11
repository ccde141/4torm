import type { CollaborationStatus } from '../../../api/collaboration';
import type { ExternalPrivateActivity } from './external-private-activity';
import type { Live } from './seat-stream-events';
import type { SeatExternalActivity } from './useSeatExternalActivity';

export function projectPrivateChatLive(input: {
  local: Live | null;
  localStreaming: boolean;
  agentActivity: ExternalPrivateActivity | null;
  agentError: string;
  legacy: SeatExternalActivity | null;
  legacyError?: string;
  factStatus: CollaborationStatus | null;
}): { live: Live | null; streaming: boolean; agentRunning: boolean; legacyRunning: boolean } {
  const agentRunning = !!input.agentActivity?.running && !input.agentError;
  const legacyRunning = !!input.legacy?.running && !input.legacyError;
  const factRunning = !input.agentError && (input.factStatus === 'running' || input.factStatus === 'queued');
  const legacyLive = (input.legacy?.kind === 'contact' || input.legacy?.kind === 'dispatch')
    && (legacyRunning || !!input.legacyError) ? input.legacy.live : null;
  const live = input.localStreaming ? input.local
    : input.agentActivity?.live ?? input.local ?? legacyLive;
  return { live, agentRunning, legacyRunning,
    streaming: input.localStreaming || agentRunning || legacyRunning || factRunning };
}
