import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindReadPort } from '../application/read-port.js';

const names = ['readNodeStatuses', 'readNodeStatus', 'readNodeSnapshot', 'readMeetingStatus'];

export function tradewindReadManifests(): ModuleMethodManifest[] {
  return [...names.map((id): ModuleMethodManifest => ({ id, kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false },
    output: { mode: 'inline' },
  })), { id: 'readAgentNodeConversation', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'read_workflow_node', description: '按工作流、执行和节点 ID 读取有限条节点对话及当前回复快照；不包含系统提示词或内部思考。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workflowId', 'executionId', 'nodeId'], properties: {
        workflowId: { type: 'string', minLength: 1 },
        executionId: { type: 'string', minLength: 1 },
        nodeId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      } },
    output: { mode: 'inline', budget: { items: { default: 8, max: 20 },
      textChars: { default: 6_000, max: 12_000 }, textLines: { default: 100, max: 200 } } },
  }, { id: 'readAgentMeetingConversation', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'read_workflow_meeting', description: '按执行身份限量读取信风会议的公共讨论或会长私聊；归档仅有指定轮次的公共讨论。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workflowId', 'executionId', 'nodeId'], properties: {
        workflowId: { type: 'string', minLength: 1 },
        executionId: { type: 'string', minLength: 1 },
        nodeId: { type: 'string', minLength: 1 },
        scope: { enum: ['public', 'chair'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        round: { type: 'integer', minimum: 1 },
      } },
    output: { mode: 'inline', budget: { items: { default: 8, max: 20 },
      textChars: { default: 6_000, max: 12_000 }, textLines: { default: 100, max: 200 } } },
  }];
}

export function tradewindReadHandlers(port: TradewindReadPort): Record<string, ModuleMethodHandler> {
  return {
    readNodeStatuses: { parse: empty, invoke: async () => port.nodeStatuses() },
    readNodeStatus: node(nodeId => port.nodeStatus(nodeId)),
    readNodeSnapshot: node(nodeId => port.nodeSnapshot(nodeId)),
    readMeetingStatus: node(nodeId => port.meetingStatus(nodeId)),
    readAgentNodeConversation: {
      parse: parseConversation,
      invoke: (_context, input) => port.agentNodeConversation(input as ReturnType<typeof parseConversation>),
    },
    readAgentMeetingConversation: {
      parse: parseMeetingConversation,
      invoke: (_context, input) => port.agentMeetingConversation(
        input as ReturnType<typeof parseMeetingConversation>),
    },
  };
}

function parseMeetingConversation(value: unknown) {
  const item = record(value);
  if (Object.keys(item).some(key => ![
    'workflowId', 'executionId', 'nodeId', 'scope', 'limit', 'round',
  ].includes(key))) throw invalid();
  const base = parseConversation({ workflowId: item.workflowId,
    executionId: item.executionId, nodeId: item.nodeId, limit: item.limit });
  if (item.scope !== undefined && item.scope !== 'public' && item.scope !== 'chair') throw invalid();
  const scope = item.scope === 'chair' ? 'chair' as const : 'public' as const;
  if (item.round !== undefined && (!Number.isInteger(item.round)
    || Number(item.round) < 1 || Number(item.round) > 1_000_000)) throw invalid();
  return { ...base, scope, ...(item.round === undefined ? {} : { round: Number(item.round) }) };
}

function parseConversation(value: unknown) {
  const item = record(value);
  if (Object.keys(item).some(key => !['workflowId', 'executionId', 'nodeId', 'limit'].includes(key))) {
    throw invalid();
  }
  const workflowId = identifier(item.workflowId);
  const executionId = identifier(item.executionId);
  const nodeId = identifier(item.nodeId);
  const limit = item.limit === undefined ? 8 : item.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20) throw invalid();
  return { workflowId, executionId, nodeId, limit: Number(limit) };
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}

function node(invoke: (nodeId: string) => Promise<unknown> | unknown): ModuleMethodHandler {
  return { parse: parseNode,
    invoke: async (_context, input) => invoke((input as { nodeId: string }).nodeId) };
}

function empty(value: unknown): Record<string, never> {
  const item = record(value);
  if (Object.keys(item).length) throw invalid();
  return {};
}

function parseNode(value: unknown): { nodeId: string } {
  const item = record(value);
  if (Object.keys(item).some(key => key !== 'nodeId') || typeof item.nodeId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.nodeId)) throw invalid();
  return { nodeId: item.nodeId };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw frameworkError({ code: 'TRADEWIND_READ_INPUT_INVALID', kind: 'validation',
    message: '信风读取参数无效', source: 'tradewind.read', retryable: false });
}
