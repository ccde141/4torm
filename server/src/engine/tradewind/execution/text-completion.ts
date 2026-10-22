import { runReActLoop } from '../../shared/react/text-loop.js';
import { SuspendSignal, normalizeToolCallResult, type ReActLoopParams, type ToolCallRecord } from '../../shared/react/native-loop.js';
import { succeededTermination } from '../../shared/react/outcome.js';
import { handoffError } from '../foundation/handoff-target.js';

/** 文本 JSON 工具与 native 使用相同的 complete_task handler，正文不能冒充交接。 */
export async function runTextCompletion(params: ReActLoopParams, completionTool: string) {
  let sealed: { output: string; record: ToolCallRecord } | undefined;
  let nudges = 0;
  const result = await runReActLoop({ ...params,
    beforeFinish: async () => nudges++ < 3 ? [`当前为正式信封轮；完成本职任务后必须调用 ${completionTool} 并选择一个合法目标。普通答复不会交接。`] : [],
    tools: { call: async (tool, args, onMeta) => {
      const outcome = normalizeToolCallResult(await params.tools!.call(tool, args, onMeta));
      if (tool === completionTool && outcome.ok) {
        sealed = { output: outcome.result, record: { tool, args, result: outcome.result, meta: outcome.meta } };
        // 复用共享循环的可中止工具边界，立即退出，不再请求模型或执行后续工具。
        throw new SuspendSignal('tradewind-completion');
      }
      return outcome;
    } },
  });
  if (!sealed) return result;
  if (params.signal?.aborted) throw handoffError('TRADEWIND_HANDOFF_ABORTED', '运行已停止，不能交接');
  return { ...result, content: sealed.output, toolCalls: [...result.toolCalls, sealed.record],
    suspended: undefined, autoOutcome: 'completed' as const, termination: succeededTermination() };
}
