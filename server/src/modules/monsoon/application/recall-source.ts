import { projectMonsoonContext } from './active-context.js';
import { sessionSourceVersion, type MonsoonMessage, type MonsoonSession } from '../domain/session.js';

export function recallSourceMessages(session: MonsoonSession, markerIndex: number): MonsoonMessage[] {
  const before = session.messages.slice(0, markerIndex), execution = session.messages[markerIndex].execution;
  if (!execution || typeof execution !== 'object') return before;
  const position = execution as { assistantId: string; toolOffset: number; textOffset?: number };
  const assistant = session.messages.find(message => message.id === position.assistantId);
  if (assistant) before.push({ ...assistant, content: assistant.content.slice(0, position.textOffset ?? 0),
    nativeContext: undefined, contextExact: undefined, toolCall: undefined, streamStopped: false,
    reasoningContent: undefined, toolSteps: Array.isArray(assistant.toolSteps) ? assistant.toolSteps.slice(0, position.toolOffset) : [] });
  return before;
}

/** Edited history is indexed from current literal records, never from a superseded summary. */
export function recallWorkInput(session: MonsoonSession, markerIndex: number) {
  const marker = session.messages[markerIndex];
  const edited = (session.historyRevision ?? 0) !== (Number(marker.historyRevision) || 0);
  const summary = edited ? recallSourceMessages(session, markerIndex).filter(message => message.type !== 'compact-marker')
    .flatMap(message => projectMonsoonContext({ messages: [message] })).filter(message => message.role !== 'system')
    .map(message => `${message.role}: ${message.content}`).join('\n') : marker.content;
  return { id: marker.id, timestamp: marker.timestamp, sessionId: session.id, sessionTitle: session.title,
    summary, sourceRevision: sessionSourceVersion(session) };
}
