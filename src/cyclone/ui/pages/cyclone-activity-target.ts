export interface CycloneActivityTarget {
  workshopId: string;
  kind?: 'seat' | 'room';
  id?: string;
}

export function parseCycloneActivityTarget(value: string): CycloneActivityTarget | null {
  const match = /^(seat|room):([^:]+):([^:]+)$/.exec(value);
  if (match) return { workshopId: match[2]!,
    kind: match[1] as 'seat' | 'room', id: match[3]! };
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)) {
    return { workshopId: value };
  }
  return null;
}
