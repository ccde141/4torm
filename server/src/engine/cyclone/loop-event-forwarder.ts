import type { ModelRequestUsageEvent } from '../shared/model-request-usage.js';
import type { ToolPreparationProgress } from '../shared/tool-progress';
import type { TokenUsage } from '../shared/llm-bridge.js';

export type LoopProgressEvent = ModelRequestUsageEvent
  | { type: 'token'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'tool-call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; result: string; ok?: boolean;
      toolImages?: import('../shared/types.js').ToolImageRef[] }
  | { type: 'error'; message: string }
  | { type: 'usage'; usage: TokenUsage | null };

export type SeatProgressEvent = ModelRequestUsageEvent
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'error'; message: string }
  | { type: 'usage'; usage: TokenUsage | null };

export type RoomProgressEvent = SeatProgressEvent & { speaker: string };

export function toSeatProgressEvent(ev: LoopProgressEvent): SeatProgressEvent | null {
  if (ev.type === 'token') return { type: 'token', content: ev.chunk };
  if (ev.type === 'reasoning') return { type: 'reasoning', content: ev.chunk };
  if (ev.type === 'tool-progress') return ev;
  if (ev.type === 'heartbeat') return { type: 'heartbeat', phase: ev.phase, elapsed: ev.elapsed };
  if (ev.type === 'error') return ev;
  if (ev.type === 'usage' || ev.type === 'model-request') return ev;
  return null;
}

export function toRoomProgressEvent(speaker: string, ev: LoopProgressEvent): RoomProgressEvent | null {
  // 群聊失败由轮次消费 termination，在执行事实提交后统一结束传输。
  if (ev.type === 'error') return null;
  const progress = toSeatProgressEvent(ev);
  return progress ? { ...progress, speaker } : null;
}
