import type { ContextMessage } from '../types.js';
import type { CompactionMode } from './contracts.js';
import { estimateCompactionTokens, estimateMessageTokens } from './estimate.js';
import { parseTextToolResponse, parseTextToolResult } from '../text-tool-protocol.js';
import { isHumanContextMessage } from '../context-origin.js';
import { recentContextStart } from './recent-context.js';

export interface CompactionSplitOptions {
  mode: CompactionMode;
  prefixRatio: number;
  protectedPrefixCount?: number;
  recentHumanTurns?: 3 | 4;
  boundaries?: (messages: readonly ContextMessage[]) => readonly number[];
}
export interface CompactionSplit {
  before: ContextMessage[];
  protected: ContextMessage[];
  prefix: ContextMessage[];
  tail: ContextMessage[];
  sourceTokens: number;
}

/** Splits only at a complete semantic boundary, keeping pending tool chains intact. */
export function splitCompactionMessages(
  messages: readonly ContextMessage[], options: CompactionSplitOptions,
): CompactionSplit | null {
  const start = protectedCount(messages, options.protectedPrefixCount);
  const recentStart = recentContextStart(messages, start, options.recentHumanTurns ?? 4);
  const candidates = safeBoundaries(messages, start, options).filter(end => end <= recentStart);
  if (!candidates.length) return null;
  const history = messages.slice(start);
  const sourceTokens = estimateCompactionTokens(history);
  const target = sourceTokens * options.prefixRatio;
  const end = options.mode === 'full' ? candidates.at(-1)!
    : nearestBoundary(messages, start, candidates, target);
  if (end <= start) return null;
  // Rewriting only an existing handoff adds no newly completed work to the summary.
  if (messages.slice(start, end).every(message => message.role === 'system')) return null;
  return { before: [...messages], protected: messages.slice(0, start),
    prefix: messages.slice(start, end), tail: messages.slice(end), sourceTokens };
}

function protectedCount(messages: readonly ContextMessage[], explicit?: number): number {
  if (explicit !== undefined) return Math.min(messages.length, Math.max(0, explicit));
  const first = messages.findIndex(message => message.role !== 'system');
  return first < 0 ? messages.length : first;
}

function safeBoundaries(messages: readonly ContextMessage[], start: number, opts: CompactionSplitOptions): number[] {
  const permitted = opts.boundaries ? new Set(opts.boundaries(messages)) : null;
  const pending = new Set<string>();
  const result: number[] = [];
  for (let index = start; index < messages.length; index++) {
    const message = messages[index];
    for (const call of message.toolCalls ?? []) pending.add(call.id);
    if (message.role === 'tool' && message.toolCallId) pending.delete(message.toolCallId);
    updateTextPending(message, pending);
    const end = index + 1;
    if (pending.size || (permitted && !permitted.has(end))) continue;
    const turnEnds = end === messages.length || isHumanTurnStart(messages[end])
      || completedWorkBoundary(message, messages[end]);
    if (!permitted && !turnEnds) continue;
    if (opts.mode === 'partial' && end === messages.length) continue;
    result.push(end);
  }
  return result;
}

function completedWorkBoundary(message: ContextMessage, next: ContextMessage | undefined): boolean {
  if (!next || /^(?:\[System: continuation|【系统：续写指令)/.test(next.content.trim())) return false;
  return message.role === 'tool' || (message.role === 'user' && !!parseTextToolResult(message.content))
    || (message.role === 'user' && !isHumanContextMessage(message))
    || (message.role === 'assistant' && !message.toolCalls?.length
      && parseTextToolResponse(message.content).kind === 'final');
}

function updateTextPending(message: ContextMessage, pending: Set<string>): void {
  if (message.role === 'assistant') {
    const parsed = parseTextToolResponse(message.content);
    if (parsed.kind === 'tool-call') pending.add(`text:${parsed.name}`);
  }
  if (message.role === 'user') {
    const result = parseTextToolResult(message.content);
    if (result) pending.delete(`text:${result.name}`);
  }
}

function isHumanTurnStart(message: ContextMessage | undefined): boolean {
  return !!message && isHumanContextMessage(message);
}

function nearestBoundary(messages: readonly ContextMessage[], start: number, candidates: number[], target: number): number {
  let chosen = candidates[0];
  let distance = Infinity;
  let cursor = start;
  let prefixTokens = 0;
  for (const candidate of candidates) {
    while (cursor < candidate) prefixTokens += estimateMessageTokens(messages[cursor++]);
    const current = Math.abs(prefixTokens - target);
    if (current < distance) { distance = current; chosen = candidate; }
  }
  return chosen;
}
