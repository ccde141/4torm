import { validateWorkflow } from '../../../engine/tradewind/foundation/workflow-validator.js';
import { frameworkError, FrameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindValidationPort } from '../application/validation-port.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import { createTradewindWorkflowStore } from './workflow-store.js';

const nodeTypes = new Set(['entry', 'agent', 'meeting', 'note', 'human-gate', 'output']);

/** 与启动前完全相同的权威规则；该查询不保存草稿、不创建运行。 */
export function createTradewindValidationPort(
  dataDir: string, store: TradewindWorkflowStore = createTradewindWorkflowStore(dataDir),
): TradewindValidationPort {
  return { validate: async input => {
    try {
      const graph = input.workflowId === undefined ? input.graph : (await store.read(input.workflowId)).graph;
      const issues = await validateWorkflow(graph, dataDir, nodeTypes, input.mode ?? 'manual');
      return { valid: issues.length === 0, issues };
    } catch (error) {
      if (error instanceof FrameworkError) throw error;
      throw frameworkError({ code: 'TRADEWIND_VALIDATION_FAILED', kind: 'io',
        message: '信风工作流校验未能完成，请检查 Agent 与模型配置',
        source: 'tradewind.validation', retryable: false }, { cause: error });
    }
  } };
}
