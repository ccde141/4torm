import type { CycloneReplySegment } from './cyclone-reply-sequence';
import type { RoomReplySegment } from './room-reply-segments';
import type { FeedMsg } from './room-stream-events';
import type { SeatTurn } from './seat-turn-projection';

interface Boundary { id: string; summary: string; reasoningOffset?: number }

export function compactedSeatTurns(turn: SeatTurn): Array<{ turn: SeatTurn; boundary?: Boundary; continued: boolean }> {
  const parts: Array<{ work: CycloneReplySegment[]; boundary?: Boundary }> = [{ work: [] }];
  const seen = new Set<string>();
  for (const segment of turn.workSegments) {
    if (!segment.compaction) { parts.at(-1)!.work.push(segment); continue; }
    if (seen.has(segment.compaction.id)) continue;
    seen.add(segment.compaction.id);
    parts.push({ work: [], boundary: segment.compaction });
  }
  if (parts.length === 1) return [{ turn, continued: false }];
  const thoughts = reasoningParts(turn.reasoning, parts.map(part => part.boundary));
  return parts.map((part, index) => ({ boundary: part.boundary, continued: index < parts.length - 1,
    turn: { ...turn, id: index === 0 ? turn.id : `${turn.id}-${part.boundary!.id}`, workSegments: part.work,
      reasoning: thoughts[index], finalContent: index === parts.length - 1 ? turn.finalContent : '',
      actionMessage: index === parts.length - 1 ? turn.actionMessage : undefined } }));
}

export function compactedRoomTurns(message: FeedMsg): Array<{ message: FeedMsg; boundary?: Boundary }> {
  const parts: Array<{ segments: RoomReplySegment[]; boundary?: Boundary }> = [{ segments: [] }];
  const seen = new Set<string>();
  for (const segment of message.segments ?? []) {
    if (segment.kind !== 'compaction') { parts.at(-1)!.segments.push(segment); continue; }
    if (seen.has(segment.id)) continue;
    seen.add(segment.id);
    parts.push({ segments: [], boundary: segment });
  }
  if (parts.length === 1) return [{ message }];
  const thoughts = reasoningParts(message.reasoning, parts.map(part => part.boundary));
  return parts.map((part, index) => {
    const latest = index === parts.length - 1;
    const texts = part.segments.filter(segment => segment.kind === 'text').map(segment => segment.content).join('');
    return { boundary: part.boundary, message: { ...message,
      key: index === 0 ? message.key : `${message.key}-${part.boundary!.id}`,
      continued: !latest, sourceIndex: latest ? message.sourceIndex : undefined,
      streaming: latest && message.streaming, phase: latest ? message.phase : undefined,
      reasoning: thoughts[index], segments: part.segments,
      tools: part.segments.flatMap(segment => segment.kind === 'tools' ? segment.tools : []),
      content: part.segments.at(-1)?.kind === 'text' ? texts : '' } };
  });
}

function reasoningParts(reasoning: string | undefined, boundaries: Array<Boundary | undefined>): Array<string | undefined> {
  const text = reasoning ?? '';
  const offsets = boundaries.slice(1).map(boundary => boundary?.reasoningOffset);
  const exact = offsets.every((offset, index) => Number.isSafeInteger(offset) && Number(offset) >= 0
    && Number(offset) <= text.length && (!index || Number(offset) >= Number(offsets[index - 1])));
  const starts = exact ? [0, ...offsets.map(Number)] : [0, ...offsets.map(() => text.length)];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length) || undefined);
}
