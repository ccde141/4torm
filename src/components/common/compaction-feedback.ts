export interface StoredCompactionFeedback { message: string; }

export function compactionFeedbackMessage(value: unknown): string {
  return value !== null && typeof value === 'object' && 'message' in value
    && typeof value.message === 'string' ? value.message : '';
}

/** Only the accepted-input fact clears a notice; a provider may omit usage at any ReAct step. */
export function compactionFeedbackEvent(event: unknown): string | null | undefined {
  if (!event || typeof event !== 'object' || !('type' in event)) return;
  if (event.type === 'input-accepted') return null;
  if (event.type === 'compaction-notice') return compactionFeedbackMessage(event) || undefined;
}

export function visibleCompactionFeedback(live: string | null | undefined, stored: unknown): string {
  return live === undefined ? compactionFeedbackMessage(stored) : live ?? '';
}
