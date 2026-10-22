import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ModuleMethodHandler, ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import type { TradewindDesignPort } from '../application/design-port.js';
import { parseWorkflowSpec, workflowAgentView, type WorkflowSpec } from '../domain/workflow-spec.js';
import { agentOutputPage, parseTextPageInput, type TextPageInput } from './agent-output-page.js';

interface WorkflowUpdate extends WorkflowSpec { workflowId: string; expectedRevision: string }

const outputBudget = {
  textChars: { default: 8_000, max: 16_000 },
  textLines: { default: 160, max: 320 },
};

export function tradewindDesignManifests(): ModuleMethodManifest[] {
  return [
    humanQuery('listAgentSummaries'),
    method('listAgents', 'list_agents', '列出框架内可用于信风节点的 Agent。', 'observe', emptySchema()),
    method('createWorkflow', 'create_workflow', '创建一个完整的信风工作流。', 'design', specSchema()),
    method('listWorkflows', 'list_workflows', '列出信风工作流摘要；指定 ID 可兼容读取小图，但结果可能截断。修改前用 read_workflow 完整分段读取。',
      'observe', listSchema(), outputBudget),
    method('readWorkflow', 'read_workflow', '分段完整读取信风编排结构，正文在 text 中；按 nextOffset 和 revision 续读到末尾再解析 JSON。更新时保留 name/orchestration/nodes/edges 未改内容，以该 revision 作为 expectedRevision；版本变化从 0 重读。',
      'observe', readSchema(), outputBudget),
    method('updateWorkflow', 'update_workflow', '读取完整结构后携带其 revision，以完整节点和边结构替换已有信风工作流；版本冲突时重新读取。',
      'design', updateSchema()),
  ];
}

export function tradewindDesignHandlers(
  design: TradewindDesignPort,
): Record<string, ModuleMethodHandler> {
  return {
    listAgentSummaries: { parse: parseEmpty, invoke: () => design.listAgentSummaries() },
    listAgents: {
      parse: parseEmpty,
      invoke: context => design.listAgents(context.budget),
    },
    createWorkflow: {
      parse: parseSpec,
      invoke: (_context, input) => design.createWorkflow(input as WorkflowSpec),
    },
    listWorkflows: {
      parse: parseList,
      invoke: (context, input) => design.listWorkflows(
        (input as { workflowId?: string }).workflowId, context.budget,
      ),
    },
    readWorkflow: {
      parse: parseRead,
      invoke: async (context, input) => {
        const value = input as { workflowId: string } & TextPageInput;
        const definition = await design.readWorkflow(value.workflowId);
        const spec = parseWorkflowSpec(workflowAgentView(definition));
        return { workflowId: definition.workflowId,
          ...agentOutputPage({ workflowId: definition.workflowId, revision: definition.revision, ...spec },
            value, context.budget, definition.revision) };
      },
    },
    updateWorkflow: {
      parse: parseUpdate,
      invoke: (_context, input) => updateWorkflow(design, input as WorkflowUpdate),
    },
  };
}

function humanQuery(id: string): ModuleMethodManifest {
  return { id, kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
    inputSchema: emptySchema(), output: { mode: 'inline' } };
}

function method(
  id: string, name: string, description: string,
  permission: ModuleMethodManifest['permission'], inputSchema: Record<string, unknown>,
  budget = outputBudget,
): ModuleMethodManifest {
  return {
    id, kind: permission === 'observe' ? 'query' : 'command', permission,
    audiences: ['agent', 'internal'], agentTool: { name, description }, inputSchema,
    output: { mode: 'inline', budget },
  };
}

function parseEmpty(value: unknown): Record<string, never> {
  const record = recordOf(value);
  if (Object.keys(record).length) throw invalidInput();
  return {};
}

function parseSpec(value: unknown): WorkflowSpec {
  const record = exact(value, ['name', 'nodes', 'edges', 'orchestration']);
  try { return parseWorkflowSpec(record); }
  catch { throw invalidInput(); }
}

function parseList(value: unknown): { workflowId?: string } {
  const record = exact(value, ['workflowId']);
  if (record.workflowId === undefined) return {};
  return { workflowId: text(record.workflowId, 200) };
}

function parseRead(value: unknown): { workflowId: string } & TextPageInput {
  const record = exact(value, ['workflowId', 'offset', 'maxChars', 'revision']);
  if (typeof record.workflowId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(record.workflowId)) throw invalidInput();
  return { workflowId: record.workflowId, ...parseTextPageInput(record) };
}

function parseUpdate(value: unknown): WorkflowUpdate {
  const record = exact(value, ['workflowId', 'expectedRevision', 'name', 'nodes', 'edges', 'orchestration']);
  const spec = parseSpec({ name: record.name, nodes: record.nodes, edges: record.edges,
    ...(record.orchestration === undefined ? {} : { orchestration: record.orchestration }) });
  return { workflowId: text(record.workflowId, 200),
    expectedRevision: revision(record.expectedRevision), ...spec };
}

function updateWorkflow(design: TradewindDesignPort, input: WorkflowUpdate): Promise<string> {
  const { workflowId, expectedRevision, ...spec } = input;
  return design.updateWorkflow(workflowId, spec, expectedRevision);
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalidInput();
  return value;
}

function exact(value: unknown, allowed: string[]): Record<string, unknown> {
  const record = recordOf(value);
  if (Object.keys(record).some(key => !allowed.includes(key))) throw invalidInput();
  return record;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw invalidInput();
  return value.trim();
}

function invalidInput() {
  return frameworkError({ code: 'TRADEWIND_DESIGN_INPUT_INVALID', kind: 'validation',
    message: '信风搭建参数无效', source: 'tradewind.design', retryable: false });
}

function emptySchema() { return { type: 'object', additionalProperties: false, properties: {} }; }
function specSchema() { return { type: 'object', additionalProperties: false,
  required: ['name', 'nodes', 'edges'], properties: specProperties(),
}; }
function listSchema() { return { type: 'object', additionalProperties: false,
  properties: { workflowId: { type: 'string', minLength: 1, maxLength: 200 } } }; }
function readSchema() { return { type: 'object', additionalProperties: false,
  required: ['workflowId'], properties: {
    workflowId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    offset: { type: 'integer', minimum: 0 },
    maxChars: { type: 'integer', minimum: 1, maximum: 16_384 },
  } }; }
function updateSchema() { return { type: 'object', additionalProperties: false,
  required: ['workflowId', 'expectedRevision', 'name', 'nodes', 'edges'], properties: {
    workflowId: { type: 'string', minLength: 1, maxLength: 200 },
    expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    ...specProperties(),
  } }; }
function specProperties() { return {
  orchestration: { enum: ['strict', 'handoff'], description: '编排类型，省略为严格依赖；条件交接按节点 FIFO 逐封单目标交接，可沿预设回边返工。' },
  name: { type: 'string', minLength: 1, maxLength: 200 },
  nodes: { type: 'array', maxItems: 1000, items: nodeSchema() },
  edges: { type: 'array', maxItems: 5000, items: { type: 'object', additionalProperties: false,
    required: ['source', 'target'], properties: { source: { type: 'string' }, target: { type: 'string' } },
  } },
}; }
function nodeSchema() { return { type: 'object', additionalProperties: false,
  required: ['id', 'type', 'label'], properties: {
    id: { type: 'string' }, type: { enum: ['entry', 'agent', 'meeting', 'note', 'human-gate', 'output'] },
    label: { type: 'string' }, agentId: { type: 'string' }, role: { type: 'string' },
    deliveryDelaySec: { type: 'number', minimum: 0 }, initialEnvelope: { type: 'string' },
    chairAgentId: { type: 'string' }, participantNodeIds: { type: 'array', items: { type: 'string' } },
    content: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } },
    archiveName: { type: 'string', maxLength: 200, description: '出口归档文件名，不含后缀和路径；空值使用时间戳。' },
  },
}; }
