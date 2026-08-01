import type { FeedMsg } from './useRoomStreamRunners';
import type { RoomReplySegment } from './room-reply-segments';

export interface TurnParts {
  workSegments: RoomReplySegment[];
  finalContent: string;
}

/**
 * 一轮流式回复可能穿插正文和工具。最后一段正文作为面向会议的回复，
 * 更早的说明与所有操作按原顺序留在“工作过程”中，避免拆成多个无主气泡。
 */
export function splitTurnSegments(message: Pick<FeedMsg, 'segments' | 'tools' | 'content'>): TurnParts {
  if (!message.segments) {
    return {
      workSegments: message.tools.length ? [{ kind: 'tools', tools: message.tools }] : [],
      finalContent: message.content,
    };
  }
  const finalIndex = message.segments.length - 1;
  const final = message.segments[finalIndex];
  // 只有真正位于回合末尾的正文才能提升为最终回复；否则保持完整事件顺序，
  // 并使用服务端聚合 content 作为可见回复，避免把派发后的旧正文错误挪到底部。
  if (final?.kind !== 'text') return { workSegments: message.segments, finalContent: message.content };
  return {
    workSegments: message.segments.slice(0, finalIndex),
    finalContent: final.content,
  };
}
