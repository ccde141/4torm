import type { TokenUsage } from '../shared/llm-bridge.js';
import type { RoomData } from './types.js';

export function resetRoomTokenUsage(room: RoomData): void {
  room.tokenUsage = undefined;
}

export function recordRoomTokenUsage(room: RoomData, usage: TokenUsage | undefined): void {
  if (!usage) return;
  if (room.tokenUsage && room.tokenUsage.promptTokens >= usage.promptTokens) return;
  room.tokenUsage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}
