import type { ContextMessage } from '../../../engine/shared/types.js';
import type { CompactionCommit } from '../../../engine/shared/compaction/index.js';
import type { ConvectionMessage } from '../infrastructure/session-store.js';

/** Speaker records stay separate so recent rounds and completed replies can be retained exactly. */
export function convectionContext(messages: readonly ConvectionMessage[]): ContextMessage[] {
  return messages.map(message => ({ role: 'user', content: `[${message.speaker}] ${convectionRecordText(message)}`,
    origin: message.speaker === '人类' ? 'human' : 'framework' }));
}

/** Public records map to their original context positions, including independently retained human input. */
export function retainedConvectionRecords(messages: readonly ConvectionMessage[],
  plan: Pick<CompactionCommit, 'before' | 'tail' | 'retainedIndexes'>, protectedPrefixCount = 0): ConvectionMessage[] {
  const indexes = plan.retainedIndexes ?? Array.from({ length: plan.tail.length },
    (_, index) => plan.before.length - plan.tail.length + index);
  return indexes.filter(index => index >= protectedPrefixCount && index < messages.length + protectedPrefixCount)
    .map(index => messages[index - protectedPrefixCount]);
}

export function convectionRecordText(message: ConvectionMessage): string {
  const incomplete = message.execution && message.execution.status !== 'running'
    ? `\n[执行未完成：${message.execution.status === 'stopped' ? '已停止' : '失败'}]`
      + (message.execution.message ? ` ${message.execution.message}` : '') : '';
  if (typeof message.modelContent === 'string') return message.modelContent + incomplete;
  const tools = message.toolCalls?.length ? `\n已观察的工具执行事实：${JSON.stringify(message.toolCalls)}\n`
    + '已返回结果的操作不要重复执行；未收到结果的操作应先核对状态。' : '';
  return message.content + incomplete + tools;
}

export function convectionRoundBoundaries(
  context: readonly ContextMessage[], records: readonly ConvectionMessage[],
): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < records.length; index++) {
    if (records[index].execution?.status === 'running') return boundaries;
    boundaries.push(index + 2);
  }
  for (let index = records.length + 1; index <= context.length; index++) {
    if (index === context.length || context[index]?.role === 'user'
      || context[index - 1]?.role === 'tool') boundaries.push(index);
  }
  return boundaries;
}
