/** A return arc is display geometry only; it never changes the saved route or its semantics. */
export function handoffReturnPath(orchestration: string | undefined,
  sourceX: number, sourceY: number, targetX: number, targetY: number): string | undefined {
  if (orchestration !== 'handoff' || sourceX < targetX) return undefined;
  const top = Math.min(sourceY, targetY) - 80 - Math.min(Math.abs(sourceX - targetX) / 4, 80);
  return `M ${sourceX} ${sourceY} C ${sourceX + 64} ${sourceY}, ${sourceX + 64} ${top}, ${sourceX} ${top}`
    + ` L ${targetX} ${top} C ${targetX - 64} ${top}, ${targetX - 64} ${targetY}, ${targetX} ${targetY}`;
}
