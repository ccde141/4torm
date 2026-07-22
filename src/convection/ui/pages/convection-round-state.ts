export type ConvectionRound = 'public' | 'chair' | null;
export type ConvectionLane = Exclude<ConvectionRound, null>;
export type ConvectionComposerMode = 'idle' | 'running' | 'blocked';

export function normalizeConvectionRound(value: unknown): ConvectionRound {
  return value === 'public' || value === 'chair' ? value : null;
}

export function getConvectionComposerMode(
  activeRound: ConvectionRound,
  lane: ConvectionLane,
): ConvectionComposerMode {
  if (activeRound === null) return 'idle';
  return activeRound === lane ? 'running' : 'blocked';
}

export function shouldBlockConvectionSessionSwitch(
  currentId: string | null,
  targetId: string,
  hasLocalRound: boolean,
): boolean {
  return hasLocalRound && currentId !== null && currentId !== targetId;
}
