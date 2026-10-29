import type { ContextMessage } from '../../shared/types.js';
import type { MeetingMessage } from './meeting-session.js';

/** One public entry maps to one model entry; split offsets remain reversible. */
export function meetingContextMessages(messages: readonly MeetingMessage[]): ContextMessage[] {
  return messages.map(message => ({
    role: message.speaker === '人类' ? 'user' : 'assistant',
    origin: message.speaker === '人类' ? 'human' : 'framework',
    content: `[${message.speaker}] ${message.content}${message.toolCalls?.length
      ? `\n[工具执行记录]\n${JSON.stringify(message.toolCalls)}` : ''}`,
  }));
}

/** Offset zero is the model's static system prompt, never part of a meeting archive. */
export function meetingContextBoundaries(messages: readonly MeetingMessage[]): number[] {
  const boundaries = [1];
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].streaming) break;
    boundaries.push(index + 2);
  }
  return boundaries;
}

export function replaceMeetingPrefix(
  messages: readonly MeetingMessage[], count: number, summary: string, now = Date.now(),
): MeetingMessage[] {
  if (!Number.isInteger(count) || count < 1 || count > messages.length
    || messages.slice(0, count).some(message => message.streaming)) {
    throw new Error('会议压缩范围无效或包含未完成发言');
  }
  return [{ speaker: '系统', content: `[会议历史摘要]\n\n${summary}`, timestamp: now },
    ...messages.slice(count)];
}
