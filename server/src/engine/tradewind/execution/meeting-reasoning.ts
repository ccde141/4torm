import type { ContextMessage } from '../../shared/types';

export interface MeetingReasoningTarget {
  reasoning?: string;
}

export function appendMeetingReasoning(target: MeetingReasoningTarget, chunk: string): void {
  if (!chunk) return;
  target.reasoning = (target.reasoning ?? '') + chunk;
}

export function createChairAssistantMessage(
  content: string,
  reasoningContent?: string,
): ContextMessage {
  return {
    role: 'assistant',
    content,
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}
