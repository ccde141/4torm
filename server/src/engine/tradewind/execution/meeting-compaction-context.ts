import type { ContextMessage } from '../../shared/types.js';
import type { MeetingMessage } from './meeting-session.js';

/** One public entry maps to one model entry; split offsets remain reversible. */
export function meetingContextMessages(messages: readonly MeetingMessage[]): ContextMessage[] {
  return messages.map(message => ({
    role: message.speaker === '人类' ? 'user' : 'assistant',
    origin: message.speaker === '人类' ? 'human' : 'framework',
    content: `[${message.speaker}] ${typeof message.modelContent === 'string' ? message.modelContent : message.content}${typeof message.modelContent !== 'string' && message.toolCalls?.length
      ? `\n[工具执行记录]\n${JSON.stringify(message.toolCalls)}` : ''}`
      + (message.executionStatus ? `\n[执行${message.executionStatus === 'stopped' ? '已停止' : '失败'}，未完成交付]` : ''),
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
  messages: readonly MeetingMessage[], count: number, summary: string, now = Date.now(), retainedIndexes?: readonly number[],
): MeetingMessage[] {
  if (!Number.isInteger(count) || count < 1 || count > messages.length
    || messages.slice(0, count).some(message => message.streaming)) {
    throw new Error('会议压缩范围无效或包含未完成发言');
  }
  if (retainedIndexes?.some((index, position) => !Number.isSafeInteger(index) || index < 0
    || index >= messages.length || (position > 0 && index <= retainedIndexes[position - 1]))) {
    throw new Error('会议压缩原文保留计划无效');
  }
  return [{ speaker: '系统', content: `[会议历史摘要]\n\n${summary}`, timestamp: now },
    ...(retainedIndexes ? retainedIndexes.map(index => messages[index]) : messages.slice(count))];
}
