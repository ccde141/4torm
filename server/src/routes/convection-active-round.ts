export type ActiveConvectionRound = 'public' | 'chair';

interface ActiveRoundEntry {
  round: ActiveConvectionRound;
  controller: AbortController;
}

const activeRounds = new Map<string, ActiveRoundEntry>();

export function registerActiveConvectionRound(
  sessionId: string,
  round: ActiveConvectionRound,
  controller: AbortController,
): void {
  activeRounds.set(sessionId, { round, controller });
}

export function getActiveConvectionRound(sessionId: string): ActiveConvectionRound | null {
  return activeRounds.get(sessionId)?.round ?? null;
}

export function abortActiveConvectionRound(sessionId: string): boolean {
  const active = activeRounds.get(sessionId);
  if (!active) return false;
  active.controller.abort();
  return true;
}

export function clearActiveConvectionRound(
  sessionId: string,
  controller: AbortController,
): void {
  if (activeRounds.get(sessionId)?.controller === controller) activeRounds.delete(sessionId);
}
