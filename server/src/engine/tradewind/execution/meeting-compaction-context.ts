import type { ContextMessage } from '../../shared/types.js';
import type { MeetingMessage } from './meeting-session.js';

/** One public entry maps to one model entry; split offsets remain reversible. */
export function meetingContextMessages(messages: readonly MeetingMessage[]): ContextMessage[] {
  return messages.map(message => ({
    role: message.speaker === '人类' ? 'user' : 'assistant',
    content: `[${message.speaker}] ${message.content}${message.toolCalls?.length
      ? `\n[工具执行记录]\n${JSON.stringify(message.toolCalls)}` : ''}`,
  }));
}

/** Offset zero is the model's static system prompt, never part of a meeting archive. */
export function meetingContextBoundaries(messages: readonly MeetingMessage[]): number[] {
  const boundaries = [1];
  messages.forEach((message, index) => {
    if (index > 0 && message.speaker === '人类') boundaries.push(index + 1);
  });
  if (!messages.at(-1)?.streaming) boundaries.push(messages.length + 1);
  return boundaries;
}

export function replaceMeetingPrefix(
  messages: readonly MeetingMessage[], count: number, summary: string, now = Date.now(),
): MeetingMessage[] {
  if (!Number.isInteger(count) || count < 1 || count > messages.length
    || (count < messages.length && messages[count].speaker !== '人类')) {
    throw new Error('会议压缩必须保留完整轮次');
  }
  return [{ speaker: '系统', content: `[会议历史摘要]\n\n${summary}`, timestamp: now },
    ...messages.slice(count)];
}
