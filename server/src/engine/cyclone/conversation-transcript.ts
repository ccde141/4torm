/** A display transcript never participates in model context construction. */
export interface CycloneDisplayHistory<T> {
  messages: T[];
  contextOffset: number;
}

/** Commit this alongside the new active context; failed summaries cannot create a boundary. */
export function captureCycloneCompaction<T>(history: CycloneDisplayHistory<T> | undefined,
  before: readonly T[], after: readonly T[], marker?: T): CycloneDisplayHistory<T> {
  const offset = history?.contextOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > before.length) {
    throw new Error('会话展示履历与当前上下文不一致，原文未更改');
  }
  return { messages: structuredClone([...(history?.messages ?? []), ...before.slice(offset),
    ...(marker ? [marker] : [])]), contextOffset: after.length };
}

/** Deleting protocol pairs must also move the display/model join without revealing retained copies. */
export function alignCycloneTranscript<T>(history: CycloneDisplayHistory<T> | undefined,
  before: readonly T[], after: readonly T[]): void {
  if (history) history.contextOffset = before.slice(0, history.contextOffset)
    .filter(message => after.includes(message)).length;
}
