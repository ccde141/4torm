import type { TokenUsage } from '../shared/llm-bridge.js';
import type { RoomData } from './types.js';
import type { LLMCaller } from '../shared/react/native-loop.js';

export function resetRoomTokenUsage(room: RoomData): void {
  room.tokenUsage = undefined;
  room.publicLatestTokenUsage = undefined;
  room.publicUsageIncomplete = undefined;
}

/** 单独更新最近请求，不改变公聊轮次用于压缩的最大上下文值。 */
export function recordRoomLatestUsage(room: RoomData, usage: TokenUsage | null | undefined): void {
  room.publicLatestTokenUsage = usage ? { ...usage } : undefined;
}

export function recordRoomTokenUsage(room: RoomData, usage: TokenUsage | null | undefined): void {
  recordRoomLatestUsage(room, usage);
  if (!usage) {
    room.tokenUsage = undefined;
    room.publicUsageIncomplete = true;
    return;
  }
  if (room.publicUsageIncomplete) return;
  if (room.tokenUsage && room.tokenUsage.promptTokens >= usage.promptTokens) return;
  room.tokenUsage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}

export function trackRoomModelUsage(
  llm: LLMCaller,
  room: RoomData,
  persist: () => Promise<void>,
): LLMCaller {
  return { call: async (...args) => {
    let response: Awaited<ReturnType<LLMCaller['call']>>;
    try { response = await llm.call(...args); }
    catch (error) {
      recordRoomTokenUsage(room, null);
      await persist();
      throw error;
    }
    recordRoomTokenUsage(room, response.usage ?? null);
    await persist();
    return response;
  } };
}
