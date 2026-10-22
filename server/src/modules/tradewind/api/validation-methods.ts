import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import type { TradewindValidationPort, WorkflowValidationInput } from '../application/validation-port.js';
import { parseWorkflowGraph } from './workflow-methods.js';
import { workflowGraphSchema } from './workflow-graph-schema.js';

export function tradewindValidationManifests(): ModuleMethodManifest[] {
  return [{ id: 'validateWorkflow', kind: 'query', permission: 'observe',
    audiences: ['human', 'internal', 'agent'],
    agentTool: { name: 'validate_workflow', description: '校验工作流编排、连线与运行模式，返回 valid/issues，不保存、不启动。优先传 workflowId 校验刚创建或更新的已保存版本；也可传完整画布 graph。workflowId 与 graph 严格二选一，勿从简化 spec 重拼 graph。' },
    inputSchema: { type: 'object', additionalProperties: false, oneOf: [
      { required: ['graph'], not: { required: ['workflowId'] } },
      { required: ['workflowId'], not: { required: ['graph'] } },
    ], properties: {
      graph: workflowGraphSchema(), workflowId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' },
      mode: { enum: ['manual', 'auto'] },
    } }, output: { mode: 'inline' } }];
}

export function tradewindValidationHandlers(port: TradewindValidationPort): Record<string, ModuleMethodHandler> {
  return { validateWorkflow: { parse: parseValidation, invoke: (_context, input) => port.validate(input as WorkflowValidationInput) } };
}

function parseValidation(value: unknown): WorkflowValidationInput {
  if (!record(value) || Object.keys(value).some(key => !['graph', 'workflowId', 'mode'].includes(key))
    || (value.mode !== undefined && value.mode !== 'manual' && value.mode !== 'auto')
    || (value.graph !== undefined) === (value.workflowId !== undefined)) throw invalid();
  const mode: Pick<WorkflowValidationInput, 'mode'> = value.mode === undefined ? {} : { mode: value.mode };
  if (value.workflowId === undefined) return { graph: parseWorkflowGraph(value.graph), ...mode };
  if (typeof value.workflowId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value.workflowId)) throw invalid();
  return { workflowId: value.workflowId, ...mode };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalid() {
  return frameworkError({ code: 'TRADEWIND_VALIDATION_INPUT_INVALID', kind: 'validation',
    message: '图校验必须在 workflowId 与 graph 之间选择一项，并使用有效运行模式',
    source: 'tradewind.validation', retryable: false });
}
