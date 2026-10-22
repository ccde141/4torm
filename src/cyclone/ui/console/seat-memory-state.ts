import type { SeatMemoryDocument, SeatMemoryEntry } from './workshop-console-model';

/** The store may normalize text. Locate save receipts by identity, never by content equality. */
export function resolveSavedSeatMemory(previous: SeatMemoryDocument, next: SeatMemoryDocument,
  entryId?: string): SeatMemoryEntry {
  const previousIds = new Set(previous.entries.map(entry => entry.id));
  const matches = entryId ? next.entries.filter(entry => entry.id === entryId)
    : next.entries.filter(entry => !previousIds.has(entry.id));
  if (matches.length !== 1) throw new Error('Cannot identify the saved seat memory. Reload before continuing.');
  return matches[0];
}

export interface SeatMemoryFeedback { readError: string; saveError: string }
export type SeatMemoryFeedbackEvent = { kind: 'read' | 'save'; error: string } | { kind: 'reset' };

/** A successful background read never acknowledges a failed user save. */
export function reduceSeatMemoryFeedback(current: SeatMemoryFeedback, event: SeatMemoryFeedbackEvent): SeatMemoryFeedback {
  if (event.kind === 'reset') return { readError: '', saveError: '' };
  return event.kind === 'read' ? { ...current, readError: event.error } : { ...current, saveError: event.error };
}
