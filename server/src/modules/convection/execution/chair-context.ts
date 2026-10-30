import { createHash } from 'node:crypto';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { ConvectionSessionData, ConvectionMessage } from '../infrastructure/session-store.js';
import { convectionRecordText } from './compaction-context.js';

/** Public observations are history, never an unbounded protected system instruction. */
export function buildConvectionChairContext(
  session: ConvectionSessionData, system: ContextMessage,
): ContextMessage[] {
  const anchor = session.chairContextPublicAnchor;
  const seen = anchor ? session.publicMessages.findIndex(message =>
    message.timestamp === anchor.timestamp && recordHash(message) === anchor.hash) : -1;
  const active = session.chairActiveContext && (!anchor || seen >= 0);
  return [system, ...(active ? session.chairActiveContext! : []),
    ...session.publicMessages.slice(active ? seen + 1 : 0).map(message => ({
      role: 'user' as const, content: `[公共会议：${message.speaker}] ${convectionRecordText(message)}`,
      origin: message.speaker === '人类' ? 'human' as const : 'framework' as const,
    })),
    ...session.chairMessages.slice(active ? session.chairContextRawCount ?? 0 : 0)
      .map(({ runId: _runId, ...message }) => ({ ...message }))];
}

export function rememberChairContextBoundary(session: ConvectionSessionData): void {
  session.chairContextRawCount = session.chairMessages.length;
  const last = session.publicMessages.at(-1);
  session.chairContextPublicAnchor = last ? { timestamp: last.timestamp, hash: recordHash(last) } : undefined;
}

/** Save the exact model continuation without rewriting either source conversation. */
export function finishConvectionChairContext(
  session: ConvectionSessionData, messages: ContextMessage[], answer: ContextMessage,
): void {
  if (!session.chairActiveContext) return;
  session.chairActiveContext = structuredClone([...messages.slice(1), answer]);
  rememberChairContextBoundary(session);
}

export function clearConvectionChairContext(session: ConvectionSessionData): void {
  session.chairActiveContext = undefined;
  session.chairContextRawCount = undefined;
  session.chairContextPublicAnchor = undefined;
  session.chairRequestEstimate = undefined;
}

export function convectionChairBoundaries(messages: readonly ContextMessage[]): number[] {
  const boundaries: number[] = [];
  for (let end = 2; end <= messages.length; end++) {
    const next = messages[end];
    const nextIsPublic = next?.content.startsWith('[公共会议：');
    const previousIsPublic = messages[end - 1].content.startsWith('[公共会议：');
    if (!next || (next.role === 'user' && (!nextIsPublic || next.content.startsWith('[公共会议：人类]')))
      || previousIsPublic) boundaries.push(end);
  }
  return boundaries;
}

function recordHash(message: ConvectionMessage): string {
  return createHash('sha256').update(`${message.speaker}\n${message.content}`
    + (typeof message.modelContent === 'string' ? `\n${message.modelContent}` : '')).digest('hex');
}
