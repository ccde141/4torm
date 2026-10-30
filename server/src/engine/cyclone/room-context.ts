import type { RoomMessage } from './types.js';
import type { ContextMessage } from '../shared/types.js';

/** Display transcripts retain every event; models consume the committed active projection. */
export function roomRecordText(message: RoomMessage, includeCompletedTools = false): string {
  if (typeof message.modelContent === 'string') return message.modelContent;
  const tools = (includeCompletedTools || message.executionStatus) && message.toolCalls?.length
    ? `\n[工具执行事实]\n${JSON.stringify(message.toolCalls)}` : '';
  return message.content + tools;
}

export function cycloneMeetingContext(records: readonly RoomMessage[]): ContextMessage[] {
  return records.map(record => ({ role: 'user', content: `[${record.speaker}] ${roomRecordText(record)}`
    + (record.executionStatus ? `\n[执行状态：${record.executionStatus}] ${record.executionError ?? ''}` : ''),
    origin: record.speaker === '人类' ? 'human' : 'framework' }));
}
