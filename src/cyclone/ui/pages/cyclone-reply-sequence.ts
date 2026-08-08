import type { DisplayBlock, DisplayMessage } from './messageDisplay';

export interface CycloneReplySegment {
  content: string;
  blocks: DisplayBlock[];
}

export function appendReplyText(segments: CycloneReplySegment[], content: string): void {
  if (!content) return;
  const current = segments.at(-1);
  if (!current || current.blocks.length > 0) {
    segments.push({ content, blocks: [] });
    return;
  }
  current.content += content;
}

export function appendReplyBlock(segments: CycloneReplySegment[], block: DisplayBlock): void {
  let current = segments.at(-1);
  if (!current) {
    current = { content: '', blocks: [] };
    segments.push(current);
  }
  current.blocks.push(block);
}

export function findReplyBlock(
  segments: CycloneReplySegment[],
  predicate: (block: DisplayBlock) => boolean,
): DisplayBlock | undefined {
  for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex--) {
    const block = segments[segmentIndex].blocks.findLast(predicate);
    if (block) return block;
  }
  return undefined;
}

export function reconcileReplyAnswer(segments: CycloneReplySegment[], answer: string): void {
  const finalText = answer.trim();
  if (!finalText) return;
  const seenParts = segments.map(segment => segment.content.trim()).filter(Boolean);
  if (!seenParts.length) {
    appendReplyText(segments, finalText);
    return;
  }
  const seen = seenParts.join('\n\n');
  if (finalText === seen || seen.includes(finalText)) return;
  const lastSeen = seenParts.at(-1)!;
  const lastPosition = finalText.lastIndexOf(lastSeen);
  if (lastPosition < 0) return;
  const tail = finalText.slice(lastPosition + lastSeen.length).trim();
  if (tail) segments.push({ content: tail, blocks: [] });
}

function answeredAsk(message: DisplayMessage | null): Extract<DisplayBlock, { kind: 'ask' }> | undefined {
  const block = message?.blocks?.find(item => item.kind === 'ask' && item.answered);
  return block?.kind === 'ask' ? block : undefined;
}

export function buildSeatDisplayHistory(
  history: DisplayMessage[],
  optimistic: DisplayMessage | null,
): DisplayMessage[] {
  if (!optimistic) return history;
  const answer = answeredAsk(optimistic);
  if (!answer) return history.some(message => message.id === optimistic.id)
    ? history
    : [...history, optimistic];
  const withoutOptimistic = history.filter(message => message.id !== optimistic.id);
  // resume 开始后，服务端会先持久化 ask 的 tool result，再继续后续 ReAct。
  // 此时一次迟到的 status reload 可能已经把“已回答 Ask”放进 history，
  // runner 中又仍保留同一条乐观回答。无论历史卡尚未回答还是已经回答，
  // 同一个问题的最新卡片都应由 runner 的即时状态接管，不能再追加第二张。
  const askIndex = withoutOptimistic.findLastIndex(message => message.blocks?.some(block => (
    block.kind === 'ask' && block.question === answer.question
  )));
  if (askIndex < 0) return [...withoutOptimistic, optimistic];
  return withoutOptimistic.map((message, index) => index === askIndex ? {
    ...message,
    blocks: message.blocks?.map(block => (
      block.kind === 'ask' && block.question === answer.question ? answer : block
    )),
  } : message);
}

export function hasUnansweredAsk(history: DisplayMessage[]): boolean {
  return history.some(message => message.blocks?.some(block => block.kind === 'ask' && !block.answered));
}
