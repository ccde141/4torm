export type TideTimePart = 0 | 1;

export function tideTimePartIsValid(value: string, maximum: number): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) <= maximum;
}

export function replaceTideTimePart(time: string, part: TideTimePart, value: string): string {
  const parts = time.split(':');
  parts[part] = value;
  return `${parts[0] ?? ''}:${parts[1] ?? ''}`;
}

export function normalizeTideTimePart(value: string): string {
  return /^\d{1,2}$/.test(value) ? value.padStart(2, '0') : value;
}

export function stepTideTimePart(value: string, maximum: number, key: string): string | null {
  if (key === 'Home') return '00';
  if (key === 'End') return String(maximum).padStart(2, '0');
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  const current = tideTimePartIsValid(value, maximum) ? Number(value) : 0;
  return String((current + (key === 'ArrowUp' ? 1 : -1) + maximum + 1) % (maximum + 1)).padStart(2, '0');
}
