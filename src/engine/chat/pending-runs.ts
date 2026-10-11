import type { ChatSession } from '../../store/chat';
import type { ChatMessage } from '../../types';
import { MonsoonMessageProjection } from './monsoon-projection';
import { findLatestAnswerableAsk } from './pending-ask';
import type { MonsoonBrowserEvent } from './sse-events';
import { retainStopped } from './stream-retention';
import { interruptedStreamContent } from './stream-terminal';

export interface PendingMonsoonRun {
  runId: string;
  events: MonsoonBrowserEvent[];
  truncated: boolean;
}

export function hydratePendingRuns(
  session: ChatSession,
  runs: PendingMonsoonRun[],
): ChatSession {
  let current = structuredClone(session);
  for (const run of runs) current = hydrateRun(current, run);
  return current;
}

function hydrateRun(session: ChatSession, run: PendingMonsoonRun): ChatSession {
  let messages = ensurePlaceholder(session.messages, run.runId, session.agentId);
  let generated = 0;
  const projection = new MonsoonMessageProjection(
    messages, run.runId, session.agentId, () => `recovered-${run.runId}-${++generated}`,
  );
  let failure = '';
  let accepted: { id: string; answer: string } | undefined;
  for (const event of run.events) {
    if (event.type === 'error') {
      failure = typeof event.message === 'string' ? event.message : '执行失败';
      continue;
    }
    if (event.type === 'reply-accepted') {
      const target = findLatestAnswerableAsk(projection.messages);
      if (target && target.runId === event.waitingRunId && typeof event.answer === 'string') {
        accepted = { id: target.id, answer: event.answer };
      }
      continue;
    }
    if (event.type !== 'usage') projection.apply(event);
  }
  messages = accepted ? markAcceptedAsk(projection.messages, accepted) : projection.messages;
  if (failure || run.truncated) {
    const reason = failure || '运行日志尾部不完整';
    messages = messages.map(message => message.id === run.runId
      ? { ...message, content: interruptedStreamContent(message.content, reason) }
      : message);
    messages = retainStopped(messages, run.runId);
  }
  return { ...session, messages };
}

function markAcceptedAsk(messages: ChatMessage[], accepted: { id: string; answer: string }): ChatMessage[] {
  return messages.map(message => message.id === accepted.id && message.ask && !message.ask.answered
    ? { ...message, ask: { ...message.ask, answered: true, reply: accepted.answer } }
    : message);
}

function ensurePlaceholder(
  messages: ChatMessage[],
  runId: string,
  agentId: string,
): ChatMessage[] {
  if (messages.some(message => message.id === runId)) return messages;
  return [...messages, {
    id: runId, inputRunId: runId, role: 'assistant', content: '', agentId,
    timestamp: new Date(0).toISOString(), streamingPhase: 'llm-waiting',
  }];
}
