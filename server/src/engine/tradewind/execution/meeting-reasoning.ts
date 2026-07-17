export interface MeetingReasoningTarget {
  reasoning?: string;
}

export function appendMeetingReasoning(target: MeetingReasoningTarget, chunk: string): void {
  if (!chunk) return;
  target.reasoning = (target.reasoning ?? '') + chunk;
}
