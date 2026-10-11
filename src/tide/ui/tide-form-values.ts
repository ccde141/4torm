export function parseTideRepeatCountInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}
