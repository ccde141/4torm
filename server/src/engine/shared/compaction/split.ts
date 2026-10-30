import type { ContextMessage } from '../types.js';
import type { CompactionMode } from './contracts.js';
import { compactionTokenCounter, estimateCompactionTokens, type CompactionTokenCounter } from './estimate.js';
import { parseTextToolResponse, parseTextToolResult } from '../text-tool-protocol.js';
import { isHumanContextMessage } from '../context-origin.js';
import { RECENT_CONTEXT_TOKENS, recentContextPreference,
  type CompletedHumanToolGroup } from './recent-context.js';

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
  /** Original indexes of the retained human wording and contiguous recent suffix. */
  retainedIndexes?: number[];
  sourceTokens: number;
}

/** Splits only at a complete semantic boundary, keeping pending tool chains intact. */
export function splitCompactionMessages(
  messages: readonly ContextMessage[], options: CompactionSplitOptions,
): CompactionSplit | null {
  const start = protectedCount(messages, options.protectedPrefixCount);
  const permitted = options.boundaries ? new Set(options.boundaries(messages)) : null;
  const { boundaries: safe, humanToolGroups } = safeBoundaries(messages, start, permitted);
  if (!safe.length) return null;
  const countTokens = compactionTokenCounter(messages);
  const recent = recentContextPreference(messages, start, options.recentHumanTurns ?? 4, safe.at(-1)!, humanToolGroups);
  const retention = retentionBoundary(start, safe, permitted, recent.start,
    compactionTokenCounter(messages, recent.retainedIndexes));
  const candidates = safe.filter(end => end <= retention.end
    && (retention.expanded || !permitted || permitted.has(end)));
  if (!candidates.length) return null;
  const history = messages.slice(start);
  const sourceTokens = estimateCompactionTokens(history);
  const target = sourceTokens * options.prefixRatio;
  const end = options.mode === 'full' ? candidates.at(-1)!
    : nearestBoundary(start, candidates, target, countTokens);
  if (end <= start) return null;
  const retainedIndexes = [...recent.retainedIndexes.filter(index => index < end),
    ...Array.from({ length: messages.length - end }, (_, index) => end + index)];
  // Rewriting only an existing handoff adds no newly completed work to the summary.
  const retained = new Set(retainedIndexes);
  if (messages.slice(start, end).every((message, index) => message.role === 'system'
    || retained.has(start + index))) return null;
  return { before: [...messages], protected: messages.slice(0, start),
    prefix: messages.slice(start, end), tail: retainedIndexes.map(index => messages[index]),
    retainedIndexes, sourceTokens };
}

function retentionBoundary(start: number, safe: number[], permitted: Set<number> | null,
  recentStart: number, countTokens: CompactionTokenCounter): { end: number; expanded: boolean } {
  const fits = (end: number) => countTokens(end) <= RECENT_CONTEXT_TOKENS;
  if (recentStart === start && fits(start)) return { end: start, expanded: false };
  const completeRounds = safe.filter(end => end <= recentStart && (!permitted || permitted.has(end)) && fits(end));
  if (completeRounds.length) return { end: completeRounds.at(-1)!, expanded: false };
  return { end: safe.find(end => end >= recentStart && fits(end)) ?? safe.at(-1)!, expanded: true };
}

function protectedCount(messages: readonly ContextMessage[], explicit?: number): number {
  if (explicit !== undefined) return Math.min(messages.length, Math.max(0, explicit));
  const first = messages.findIndex(message => message.role !== 'system');
  return first < 0 ? messages.length : first;
}

function safeBoundaries(messages: readonly ContextMessage[], start: number, permitted: Set<number> | null): {
  boundaries: number[]; humanToolGroups: Map<number, CompletedHumanToolGroup>;
} {
  const completedEnd = permitted ? Math.max(start, ...permitted) : messages.length;
  const pending = new Set<string>();
  const result: number[] = [];
  const humanToolGroups = new Map<number, CompletedHumanToolGroup>();
  let groupStart = -1;
  let humanResults: number[] = [];
  for (let index = start; index < Math.min(messages.length, completedEnd); index++) {
    const message = messages[index];
    const textResult = message.role === 'user' ? parseTextToolResult(message.content) : null;
    const matchedResult = (message.role === 'tool' && message.toolCallId && pending.has(message.toolCallId))
      || (textResult && pending.has(`text:${textResult.name}`));
    for (const call of message.toolCalls ?? []) pending.add(call.id);
    if (message.role === 'tool' && message.toolCallId) pending.delete(message.toolCallId);
    updateTextPending(message, pending);
    const end = index + 1;
    if (groupStart < 0 && pending.size) groupStart = index;
    if (matchedResult && isHumanContextMessage(message)) humanResults.push(index);
    if (groupStart >= 0 && !pending.size) {
      const group = { start: groupStart, end };
      for (const humanIndex of humanResults) humanToolGroups.set(humanIndex, group);
      groupStart = -1; humanResults = [];
    }
    if (pending.size) continue;
    const turnEnds = end === messages.length || isHumanTurnStart(messages[end])
      || completedWorkBoundary(message, messages[end]);
    if (!turnEnds && !permitted?.has(end)) continue;
    result.push(end);
  }
  return { boundaries: result, humanToolGroups };
}

function completedWorkBoundary(message: ContextMessage, next: ContextMessage | undefined): boolean {
  if (!next || /^(?:\[System: continuation|【系统：续写指令)/.test(next.content.trim())) return false;
  return message.role === 'tool' || message.role === 'user'
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

function nearestBoundary(start: number, candidates: number[], target: number, countTokens: CompactionTokenCounter): number {
  let chosen = candidates[0];
  let distance = Infinity;
  for (const candidate of candidates) {
    const current = Math.abs(countTokens(start, candidate) - target);
    if (current < distance) { distance = current; chosen = candidate; }
  }
  return chosen;
}
