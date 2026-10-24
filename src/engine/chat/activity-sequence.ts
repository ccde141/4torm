import type { ChatActivity, ChatMessage, TeamActivity } from '../../types';

export function appendActivityText(message: ChatMessage, content: string): ChatMessage {
  if (!content) return message;
  const sequence = [...(message.activitySequence ?? [])];
  const last = sequence.at(-1);
  if (last?.kind === 'text') sequence[sequence.length - 1] = { ...last, content: last.content + content };
  else sequence.push({ kind: 'text', content });
  return { ...message, activitySequence: sequence };
}

export function appendActivityTool(message: ChatMessage, index: number): ChatMessage {
  return { ...message, activitySequence: [...(message.activitySequence ?? []), { kind: 'tool', index }] };
}

export function appendTeamActivity(message: ChatMessage, event: TeamActivity): ChatMessage {
  const sequence = message.activitySequence ?? [];
  if (sequence.some(item => item.kind === 'team' && item.event.id === event.id)) return message;
  return { ...message, activitySequence: [...sequence, { kind: 'team', event }] };
}

/** Reconcile a completed answer or interruption suffix without moving earlier text past tools. */
export function activitySequence(message: ChatMessage): ChatActivity[] {
  const sequence = message.activitySequence;
  if (!sequence?.length) return [];
  const parts = sequence.filter(item => item.kind === 'text').map(item => item.content);
  const answer = message.content.trim();
  const displayed = parts.join('\n\n').trim();
  if (!answer || answer === displayed || answer === parts.join('').trim()
    || parts.some(part => part.trim() === answer)) return sequence;
  const last = parts.at(-1)?.trim();
  const position = last ? answer.lastIndexOf(last) : -1;
  const tail = position >= 0 ? answer.slice(position + last!.length).trim() : answer;
  return tail ? [...sequence, { kind: 'text', content: tail }] : sequence;
}

/** Only trailing prose is the answer; earlier notes remain beside the work that followed them. */
export function projectActivityTurn(message: ChatMessage): { work: ChatActivity[]; answer: string } {
  const sequence = activitySequence(message).filter(item => item.kind !== 'text' || !!item.content.trim());
  const last = sequence.at(-1);
  return last?.kind === 'text'
    ? { work: sequence.slice(0, -1), answer: last.content }
    : { work: sequence, answer: '' };
}

export function parseTeamActivity(value: Record<string, unknown>): TeamActivity | undefined {
  if (value.type !== 'team-activity' || typeof value.id !== 'string'
    || typeof value.memberId !== 'string' || typeof value.timestamp !== 'string'
    || !['dispatched', 'reported', 'injected', 'acknowledged', 'reviewed'].includes(String(value.stage))) return undefined;
  const result: TeamActivity = { id: value.id, memberId: value.memberId,
    timestamp: value.timestamp, stage: value.stage as TeamActivity['stage'] };
  for (const field of ['memberName', 'runId', 'reportId', 'outcome', 'decision', 'preview'] as const) {
    if (typeof value[field] === 'string') result[field] = value[field];
  }
  return result;
}
