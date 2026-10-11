import type { ChatMessage } from '../../types';
import type { AskStatus } from './ask-status';

export interface AnswerableAsk {
  id: string;
  runId: string;
}

export type PendingAskInputRoute = 'answer' | 'blocked' | 'new' | 'steer';

/** Keep composer routing tied to the latest ask and its own verified feedback. */
export function decidePendingAskInputRoute(
  ask: AnswerableAsk | undefined,
  feedback: { askId: string; status: AskStatus } | null,
  streaming: boolean,
): PendingAskInputRoute {
  if (!ask) return streaming ? 'steer' : 'new';
  if (streaming || feedback?.askId !== ask.id) return 'blocked';
  if (feedback.status === 'expired') return 'new';
  if (feedback.status === 'waiting' || feedback.status === 'failed') return 'answer';
  return 'blocked';
}

/** Only the latest ask is eligible; an answered or unbound ask never revives an older one. */
export function findLatestAnswerableAsk(messages: readonly ChatMessage[]): AnswerableAsk | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (!message.ask) continue;
    if (message.ask.answered) return undefined;
    const runId = message.ask.sourceRunId || precedingAssistantRunId(messages, index);
    return runId ? { id: message.id, runId } : undefined;
  }
  return undefined;
}

function precedingAssistantRunId(messages: readonly ChatMessage[], askIndex: number): string | undefined {
  for (let index = askIndex - 1; index >= 0; index--) {
    const previous = messages[index]!;
    if (previous.role === 'assistant') return previous.inputRunId;
  }
  return undefined;
}
