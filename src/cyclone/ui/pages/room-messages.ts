import type { FeedMsg } from './room-stream-events';
import type { RoomReplySegment } from './room-reply-segments';
import type { CycloneUsage } from './cyclone-token-usage';
import type { StoredCompactionFeedback } from '../../../components/common/compaction-feedback';
import { isCompactionHistory } from '../../../components/common/compaction-history';
import type { ToolImageRef } from '../../../engine/tool-media';

export interface RoomToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  toolImages?: ToolImageRef[];
}

export interface RoomMsg {
  id?: string;
  turnId?: string;
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: RoomToolCall[];
  segments?: RoomReplySegment[];
  kind?: 'dispatch-result' | 'membership';
  dispatchId?: string;
  seatId?: string;
  membershipAction?: 'joined' | 'left';
}

export interface RoomData {
  publicCurrentInput?: import('../../../lib/model-usage').CurrentInputEstimate;
  id: string;
  title: string;
  topic: string;
  mode?: 'build' | 'plan';
  participantSeatIds: string[];
  publicMessages: RoomMsg[];
  tokenUsage?: CycloneUsage;
  modelUsage?: import('../../../lib/model-usage').ModelUsageProgress;
  publicLatestTokenUsage?: CycloneUsage;
  compactionNotice?: StoredCompactionFeedback;
  compaction?: unknown;
}

export async function readRoomError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body?.error || `${fallback}（HTTP ${response.status}）`;
}

export function publicToFeed(messages: RoomMsg[]): FeedMsg[] {
  return messages.map((message, sourceIndex) => {
    const system = message.speaker === 'system' || message.speaker === '系统';
    const archive = !message.kind && system && isCompactionHistory(message.content);
    return {
      key: message.id || `history-${sourceIndex}`,
      sourceIndex,
      turnId: message.turnId,
      speaker: archive ? '归档摘要' : message.speaker,
      content: message.content,
      isHuman: message.speaker === '人类',
      isArchiveSummary: archive,
      kind: message.kind,
      dispatchId: message.dispatchId,
      seatId: message.seatId,
      membershipAction: message.membershipAction,
      reasoning: message.reasoning,
      segments: message.segments,
      tools: (message.toolCalls || []).map(tool => ({
        tool: tool.tool, args: tool.args, result: tool.result, toolImages: tool.toolImages, status: 'success' as const,
      })),
    };
  });
}
