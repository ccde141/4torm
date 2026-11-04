import type { MonsoonMessage, MonsoonSession } from './session.js';

function material(message: MonsoonMessage): string {
  return JSON.stringify([message.role, message.content, message.type, message.contextOmitted,
    message.toolSteps, message.nativeContext, message.images, message.contextCheckpoint]);
}

/** Appending new turns and completing a live reply preserve earlier source identity. Editing old facts does not. */
export function historyRevision(current: MonsoonSession, incoming: MonsoonSession): number {
  const next = new Map(incoming.messages.map(message => [message.id, message]));
  const changed = current.messages.some(message => {
    const replacement = next.get(message.id);
    if (!replacement) return true;
    if (message.role === 'assistant' && message.runCommitted === false) return false;
    return material(message) !== material(replacement);
  });
  return (current.historyRevision ?? 0) + Number(changed);
}
