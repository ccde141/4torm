import { contextToDisplay, type DisplayMessage } from './messageDisplay';

type StoredMessages = Parameters<typeof contextToDisplay>[0];

export interface SeatDisplayHistory { messages: StoredMessages; contextOffset: number }

/** Archived records are readable; active source indexes still address the original edit API. */
export function projectSeatDisplayHistory(messages: StoredMessages, history: SeatDisplayHistory | undefined,
  askFallback: string, options: { supervisor?: boolean } = {}): DisplayMessage[] {
  if (!history) return contextToDisplay(messages, askFallback, options);
  if (!Number.isSafeInteger(history.contextOffset) || history.contextOffset < 0 || history.contextOffset > messages.length) {
    throw new Error('工位展示履历的上下文位置无效');
  }
  const archived = contextToDisplay(history.messages, askFallback, options).map(message => {
    const { sourceIndex: _sourceIndex, ...record } = message;
    return { ...record, id: `archive-${record.id}` };
  });
  const active = contextToDisplay(messages.slice(history.contextOffset), askFallback, options).map(message => ({
    ...message, id: `active-${message.id}`, ...(message.sourceIndex !== undefined
      ? { sourceIndex: message.sourceIndex + history.contextOffset } : {}),
  }));
  return [...archived, ...active];
}
