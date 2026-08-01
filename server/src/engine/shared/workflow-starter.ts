import {
  startStoredTradewindExecution,
  type TradewindStartResult,
} from '../../services/tradewind-execution.js';

type StartStored = (input: {
  dataDir: string;
  workflowId: string;
  initialInput?: string;
  trigger: { source: 'conversation' };
}) => Promise<TradewindStartResult>;

export async function execStartWorkflow(
  dataDir: string,
  args: Record<string, string>,
  context: { sessionId?: string; agentId?: string } = {},
  start: StartStored = startStoredTradewindExecution,
): Promise<{
  ok: boolean;
  result: string;
  meta: { workflowExecution?: TradewindStartResult };
}> {
  const workflowId = args.workflowId?.trim();
  if (!workflowId) return { ok: false, result: '启动失败：缺少 workflowId', meta: {} };
  try {
    const execution = await start({
      dataDir,
      workflowId,
      initialInput: args.initialInput?.trim() || undefined,
      trigger: { source: 'conversation', ...context },
    });
    return {
      ok: true,
      result: `信风工作流「${execution.workflowName}」已启程，执行 ID：${execution.executionId}`,
      meta: { workflowExecution: execution },
    };
  } catch (error) {
    return { ok: false, result: `启动失败：${(error as Error).message}`, meta: {} };
  }
}
