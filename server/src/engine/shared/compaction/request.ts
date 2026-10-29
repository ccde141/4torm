import type { ContextMessage } from '../types.js';
import type { CompactionSummaryInput } from './contracts.js';

/** The current task changes at the end of the request; the original history stays in order. */
export function buildCompactionMessages(
  input: Pick<CompactionSummaryInput, 'messages' | 'prompt'>, preferBody = false,
): ContextMessage[] {
  const instruction = preferBody ? input.prompt + '\n思考预算已经用尽。现在直接输出简短压缩正文，'
    + '先保留任务目标、已核实事实、必要 ID 与未完成事项；不要继续推导，不要输出思考过程。' : input.prompt;
  return [...input.messages, { role: 'user', origin: 'framework', content: instruction }];
}
