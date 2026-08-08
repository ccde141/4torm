import type { CycloneReplySegment } from './cyclone-reply-sequence';
import type { DisplayMessage } from './messageDisplay';

export interface SeatTurn {
  id: string;
  messages: DisplayMessage[];
  workSegments: CycloneReplySegment[];
  finalContent: string;
  reasoning?: string;
  /** 只有最终可见回答拥有顶层操作；工具轮不能产生悬空的编辑、删除按钮。 */
  actionMessage?: DisplayMessage;
}

export type SeatTimelineItem =
  | { kind: 'message'; message: DisplayMessage }
  | { kind: 'turn'; turn: SeatTurn };

/**
 * 服务端保存的是 LLM 协议记录，一次人类请求会产生多条 assistant/tool 消息；
 * 界面需要的是稳定工作回合。这里仅建立显示投影，不改变协议记录或原始索引。
 */
export function projectSeatTimeline(history: DisplayMessage[]): SeatTimelineItem[] {
  const timeline: SeatTimelineItem[] = [];
  let pending: DisplayMessage[] = [];
  const flush = () => {
    if (!pending.length) return;
    timeline.push({ kind: 'turn', turn: createStoredSeatTurn(pending) });
    pending = [];
  };

  for (const message of history) {
    if (message.role === 'assistant') {
      pending.push(message);
      continue;
    }
    flush();
    timeline.push({ kind: 'message', message });
  }
  flush();
  return timeline;
}

export function createLiveSeatTurn(
  segments: CycloneReplySegment[],
  reasoning?: string,
): SeatTurn {
  return createSeatTurn('live-seat-turn', [], segments, reasoning);
}

function createStoredSeatTurn(messages: DisplayMessage[]): SeatTurn {
  const segments = messages.flatMap(message => messageSegments(message));
  const reasoning = messages.map(message => message.reasoning?.trim()).filter(Boolean).join('\n\n');
  return createSeatTurn(
    `seat-turn-${messages[0].id}-${messages.at(-1)!.id}`,
    messages,
    segments,
    reasoning || undefined,
  );
}

function createSeatTurn(
  id: string,
  messages: DisplayMessage[],
  sourceSegments: CycloneReplySegment[],
  reasoning?: string,
): SeatTurn {
  const segments = sourceSegments.flatMap(normalizeSegment);
  const final = segments.at(-1);
  const hasFinalAnswer = !!final?.content && final.blocks.length === 0;
  const finalContent = hasFinalAnswer ? final.content : '';
  const workSegments = hasFinalAnswer ? segments.slice(0, -1) : segments;
  const actionMessage = hasFinalAnswer
    ? messages.findLast(message => message.content.trim() === finalContent && message.sourceIndex !== undefined)
    : undefined;
  return { id, messages, workSegments, finalContent, reasoning, actionMessage };
}

function messageSegments(message: DisplayMessage): CycloneReplySegment[] {
  const segments: CycloneReplySegment[] = [];
  if (message.content) segments.push({ content: message.content, blocks: [] });
  if (message.blocks?.length) segments.push({ content: '', blocks: message.blocks });
  return segments;
}

/** 同一流片段可能同时含工具前说明和工具块；拆开后才能准确识别真正的末尾回答。 */
function normalizeSegment(segment: CycloneReplySegment): CycloneReplySegment[] {
  const normalized: CycloneReplySegment[] = [];
  if (segment.content) normalized.push({ content: segment.content, blocks: [] });
  if (segment.blocks.length) normalized.push({ content: '', blocks: segment.blocks });
  return normalized;
}
