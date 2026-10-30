import type { ContextMessage } from '../types.js';
import { isHumanContextMessage } from '../context-origin.js';
import { estimateCompactionTokens } from './estimate.js';
import { parseTextToolResult } from '../text-tool-protocol.js';

export const RECENT_CONTEXT_TOKENS = 30_000;

export interface RecentContextPreference {
  start: number;
  retainedIndexes: number[];
}

export interface CompletedHumanToolGroup {
  start: number;
  end: number;
}

/** Human wording has priority over its later tool work within the recent-context allowance. */
export function recentContextPreference(
  messages: readonly ContextMessage[], start: number, turns: 3 | 4, mandatoryStart: number,
  humanToolGroups: ReadonlyMap<number, CompletedHumanToolGroup>,
): RecentContextPreference {
  const humans: number[] = [];
  for (let index = messages.length - 1; index >= start && humans.length < turns; index--) {
    if (isHumanContextMessage(messages[index])) humans.push(index);
  }
  let retainedIndexes: number[] = [];
  for (const index of humans) {
    if (index >= mandatoryStart) continue;
    const message = messages[index];
    const dependsOnTool = message.role === 'tool'
      || (message.role === 'user' && !!parseTextToolResult(message.content));
    const group = humanToolGroups.get(index);
    if (dependsOnTool && !group) continue;
    const required = group ? Array.from({ length: group.end - group.start }, (_, offset) => group.start + offset) : [index];
    const next = [...new Set([...retainedIndexes, ...required])].sort((left, right) => left - right);
    const retained = [...next.map(selected => messages[selected]), ...messages.slice(mandatoryStart)];
    if (estimateCompactionTokens(retained) <= RECENT_CONTEXT_TOKENS) retainedIndexes = next;
  }
  return { start: humans.length === turns ? humans.at(-1)! : start,
    retainedIndexes };
}
