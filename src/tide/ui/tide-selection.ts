export type TideSelection =
  | { kind: 'task'; agentId: string; taskId: string }
  | { kind: 'session'; agentId: string; sessionId: string }
  | { kind: 'create'; agentId: string };

export interface TidePageIdentity {
  agentId: string | null;
  selection: TideSelection | null;
}

export function selectTideAgent(state: TidePageIdentity, agentId: string): TidePageIdentity {
  return { agentId: state.agentId === agentId ? null : agentId, selection: null };
}

export function selectTideTask(
  _state: TidePageIdentity, agentId: string, taskId: string,
): TidePageIdentity {
  return { agentId, selection: { kind: 'task', agentId, taskId } };
}

export function selectTideSession(
  _state: TidePageIdentity, agentId: string, sessionId: string,
): TidePageIdentity {
  return { agentId, selection: { kind: 'session', agentId, sessionId } };
}

export function selectTideCreate(_state: TidePageIdentity, agentId: string): TidePageIdentity {
  return { agentId, selection: { kind: 'create', agentId } };
}

export function acceptsTideResponse(
  state: TidePageIdentity, expected: TideSelection | null,
): boolean {
  if (!expected || state.agentId !== expected.agentId) return false;
  const current = state.selection;
  if (!current || current.kind !== expected.kind || current.agentId !== expected.agentId) return false;
  if (current.kind === 'task' && expected.kind === 'task') return current.taskId === expected.taskId;
  if (current.kind === 'session' && expected.kind === 'session') return current.sessionId === expected.sessionId;
  return current.kind === 'create' && expected.kind === 'create';
}
