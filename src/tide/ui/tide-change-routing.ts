import type { TideChangeEvent } from './tide-change-client';
import type { TidePageIdentity } from './tide-selection';

export function tideRefreshTargets(identity: TidePageIdentity, event: TideChangeEvent) {
  const selection = identity.selection;
  return {
    overview: true,
    sessions: (event.scope === 'task' || event.scope === 'session')
      && event.agentId === identity.agentId,
    task: selection?.kind === 'task' && event.taskId === selection.taskId,
    session: selection?.kind === 'session' && (
      event.scope === 'session' && event.agentId === selection.agentId && event.sessionId === selection.sessionId
      || event.scope === 'run' && event.agentId === selection.agentId),
  };
}
