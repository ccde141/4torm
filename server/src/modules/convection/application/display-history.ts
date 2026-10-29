import type { ConvectionMessage, ConvectionSessionData } from '../infrastructure/session-store.js';
import { randomUUID } from 'node:crypto';

export function convectionChairDisplayMessages(session: ConvectionSessionData): ConvectionSessionData['chairMessages'] {
  return session.chairDisplayHistory ? [...session.chairDisplayHistory,
    ...session.chairMessages.slice(session.chairDisplayContextCount ?? 0)] : session.chairMessages;
}

/** The display cursor skips retained model copies; source records stay available to people. */
export function convectionDisplayMessages(session: ConvectionSessionData): ConvectionMessage[] {
  const completed = session.publicDisplayHistory
    ? [...session.publicDisplayHistory, ...session.publicMessages.slice(session.publicDisplayContextCount ?? 0)]
    : session.publicMessages;
  const messages = session.publicExecutionDraft ? [...completed, session.publicExecutionDraft] : completed;
  const inline = new Set(messages.flatMap(message => message.compactions?.map(item => item.id) ?? []));
  return messages.filter(message => !message.compactionId || !inline.has(message.compactionId));
}

export function retainConvectionDisplay(before: ConvectionSessionData, next: ConvectionSessionData,
  marker: ConvectionMessage): void {
  const ids = new Map(before.publicMessages.map(record => [record, record.recordId ?? randomUUID()]));
  const markerId = marker.recordId ?? randomUUID();
  next.publicDisplayHistory = [...convectionDisplayMessages(before).map(record => ({ ...record,
    recordId: record.recordId ?? ids.get(record) ?? randomUUID() })), { ...marker, recordId: markerId }];
  next.publicMessages = next.publicMessages.map(record => ({ ...record,
    recordId: record === marker ? markerId : record.recordId ?? ids.get(record) ?? randomUUID() }));
  next.publicDisplayContextCount = next.publicMessages.length;
}

export function editConvectionDisplay(session: ConvectionSessionData, index: number,
  content?: string): boolean {
  const target = convectionDisplayMessages(session)[index];
  if (!target) return false;
  const matching = session.publicMessages.find(message => message === target
    || (target.recordId !== undefined && message.recordId === target.recordId));
  if (content !== undefined) {
    target.content = content;
    if (matching && matching !== target) matching.content = content;
  } else {
    if (session.publicExecutionDraft === target) session.publicExecutionDraft = undefined;
    if (session.publicDisplayHistory) session.publicDisplayHistory = session.publicDisplayHistory.filter(message => message !== target);
    const activeIndex = matching ? session.publicMessages.indexOf(matching) : -1;
    if (activeIndex >= 0) {
      session.publicMessages.splice(activeIndex, 1);
      if (activeIndex < (session.publicDisplayContextCount ?? 0)) {
        session.publicDisplayContextCount = (session.publicDisplayContextCount ?? 0) - 1;
      }
    }
  }
  return true;
}
