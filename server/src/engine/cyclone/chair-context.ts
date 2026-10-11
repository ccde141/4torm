import { createHash } from 'node:crypto';
import type { ContextMessage, RoomData, RoomMessage } from './types.js';

/** A chair observes this room's complete history; only identity remains protected. */
export function buildCycloneChairContext(room: RoomData, system: ContextMessage): ContextMessage[] {
  const anchor = room.chairContextPublicAnchor;
  const seen = anchor ? room.publicMessages.findIndex(message => message.timestamp === anchor.timestamp
    && recordHash(message) === anchor.hash) : -1;
  const active = room.chairActiveContext && room.chairContextPublicVersion === (room.dispatchContextVersion ?? 0)
    && (!anchor || seen >= 0);
  return [system, ...(active ? room.chairActiveContext! : []),
    ...room.publicMessages.slice(active ? seen + 1 : 0).map(message => ({ role: 'user' as const,
      content: `[公共会议：${message.speaker}] ${message.content}${message.toolCalls?.length
        ? `\n[工具执行事实]\n${JSON.stringify(message.toolCalls)}` : ''}` })),
    ...(room.chairMessages ?? []).slice(active ? room.chairContextRawCount ?? 0 : 0)
      .map(message => ({ ...message }))];
}

export function rememberChairContextBoundary(room: RoomData): void {
  room.chairContextRawCount = room.chairMessages?.length ?? 0;
  room.chairContextPublicVersion = room.dispatchContextVersion ?? 0;
  const last = room.publicMessages.at(-1);
  room.chairContextPublicAnchor = last ? { timestamp: last.timestamp, hash: recordHash(last) } : undefined;
}

export function finishCycloneChairContext(room: RoomData, messages: ContextMessage[], answer: ContextMessage): void {
  if (!room.chairActiveContext) return;
  room.chairActiveContext = structuredClone([...messages.slice(1), answer]);
  rememberChairContextBoundary(room);
}

export function clearCycloneChairContext(room: RoomData): void {
  room.chairActiveContext = undefined;
  room.chairContextRawCount = undefined;
  room.chairContextPublicVersion = undefined;
  room.chairContextPublicAnchor = undefined;
  room.chairRequestEstimate = undefined;
}

export function cycloneChairBoundaries(messages: readonly ContextMessage[]): number[] {
  const boundaries: number[] = [];
  for (let end = 2; end <= messages.length; end++) {
    const next = messages[end];
    const previousIsPublic = messages[end - 1].content.startsWith('[公共会议：');
    const nextIsPublic = next?.content.startsWith('[公共会议：');
    if (!next || (next.role === 'user' && (!nextIsPublic || next.content.startsWith('[公共会议：人类]')))
      || (previousIsPublic && !nextIsPublic)) boundaries.push(end);
  }
  return boundaries;
}

function recordHash(message: RoomMessage): string {
  return createHash('sha256').update(JSON.stringify([message.speaker, message.content, message.toolCalls])).digest('hex');
}
