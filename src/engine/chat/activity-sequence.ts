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
  const key = teamActivityKey(event);
  const index = sequence.findIndex(item => item.kind === 'team' && teamActivityKey(item.event) === key);
  if (index < 0) return { ...message, activitySequence: [...sequence, { kind: 'team', event }] };
  const previous = sequence[index];
  if (previous.kind !== 'team') return message;
  const retained = retainEarlierTimestamp(previous.event, event);
  return retained === previous.event ? message : { ...message,
    activitySequence: sequence.map((item, position) => position === index ? { kind: 'team', event: retained } : item) };
}

export function teamActivityKey(event: TeamActivity): string {
  return event.reportId ? `report:${JSON.stringify([event.reportId, event.stage])}` : `event:${event.id}`;
}

function retainEarlierTimestamp(previous: TeamActivity, incoming: TeamActivity): TeamActivity {
  const timestamp = Date.parse(incoming.timestamp);
  const prior = Date.parse(previous.timestamp);
  return Number.isFinite(timestamp) && (!Number.isFinite(prior) || timestamp < prior)
    ? { ...previous, timestamp: incoming.timestamp } : previous;
}

/** Legacy duplicate notifications remain stored; only their visible projection is reconciled. */
function reconcileTeamActivities(sequence: ChatActivity[]): ChatActivity[] {
  const result: ChatActivity[] = [];
  const positions = new Map<string, number>();
  const compactions = new Set<string>();
  for (const item of sequence) {
    if (item.kind === 'compact') {
      if (!compactions.has(item.markerId)) result.push(item);
      compactions.add(item.markerId);
      continue;
    }
    if (item.kind !== 'team') { result.push(item); continue; }
    const key = teamActivityKey(item.event);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, result.length);
      result.push(item);
    } else {
      const previous = result[position];
      if (previous.kind === 'team') result[position] = { kind: 'team',
        event: retainEarlierTimestamp(previous.event, item.event) };
    }
  }
  return result;
}

/** Reconcile a completed answer or interruption suffix without moving earlier text past tools. */
export function activitySequence(message: ChatMessage): ChatActivity[] {
  if (!message.activitySequence?.length) return [];
  const sequence = reconcileTeamActivities(message.activitySequence);
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
