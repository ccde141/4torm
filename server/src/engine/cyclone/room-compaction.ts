import type { RoomMessage } from './types.js';

export const CYCLONE_ROOM_KEEP_ROUNDS = 3;

export type RoomCompactionPlan = {
  ok: true;
  archivedMessages: RoomMessage[];
  keptMessages: RoomMessage[];
  summaryInput: string;
  keptRoundCount: number;
} | {
  ok: false;
  reason: 'below-budget' | 'not-enough-rounds' | 'nothing-to-compact';
};

function humanRoundStarts(messages: RoomMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (message.speaker === '人类') starts.push(index);
  });
  return starts;
}

function serializeMessage(message: RoomMessage): string {
  const parts = [`${message.speaker}: ${message.content}`];
  for (const call of message.toolCalls ?? []) {
    parts.push(`工具 ${call.tool}: 参数=${JSON.stringify(call.args)} 结果=${call.result}`);
  }
  return parts.join('\n');
}

function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    const compactScript = (code >= 0x4E00 && code <= 0x9FFF)
      || (code >= 0x3040 && code <= 0x30FF)
      || (code >= 0xAC00 && code <= 0xD7AF);
    tokens += compactScript ? 0.6 : 0.3;
  }
  return Math.ceil(tokens);
}

function estimatePublicTokens(messages: RoomMessage[]): number {
  return messages.reduce((total, message) => total + estimateTextTokens(serializeMessage(message)), 0);
}

export function planRoomCompaction(
  messages: RoomMessage[],
  promptTokens: number | undefined,
  promptBudget: number,
): RoomCompactionPlan {
  const observedTokens = promptTokens && promptTokens > 0
    ? promptTokens
    : estimatePublicTokens(messages);
  if (observedTokens < promptBudget) {
    return { ok: false, reason: 'below-budget' };
  }
  const starts = humanRoundStarts(messages);
  if (starts.length <= CYCLONE_ROOM_KEEP_ROUNDS) {
    return { ok: false, reason: 'not-enough-rounds' };
  }
  const keepFrom = starts[starts.length - CYCLONE_ROOM_KEEP_ROUNDS];
  const archivedMessages = messages.slice(0, keepFrom);
  const summaryInput = archivedMessages.map(serializeMessage).join('\n\n').trim();
  if (!summaryInput) return { ok: false, reason: 'nothing-to-compact' };
  return {
    ok: true,
    archivedMessages,
    keptMessages: messages.slice(keepFrom),
    summaryInput,
    keptRoundCount: CYCLONE_ROOM_KEEP_ROUNDS,
  };
}
