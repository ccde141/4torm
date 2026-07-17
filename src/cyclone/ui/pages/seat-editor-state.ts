import type { SeatDraft } from './SeatPanel';

export interface LoadedSeatEditorView {
  kind: 'edit-seat';
  id: string;
  draft: SeatDraft;
}

export function resolveLoadedSeatEditor<T extends { kind: string; id?: string } | null>(
  current: T,
  seatId: string,
  draft: SeatDraft,
): T | LoadedSeatEditorView {
  if (current?.kind !== 'loading-seat' || current.id !== seatId) return current;
  return { kind: 'edit-seat', id: seatId, draft };
}
