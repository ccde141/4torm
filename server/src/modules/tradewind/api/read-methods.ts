import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindReadPort, TradewindReadIdentity } from '../application/read-port.js';

const names = ['readNodeStatuses', 'readNodeStatus', 'readNodeSnapshot', 'readMeetingStatus'];

export function tradewindReadManifests(): ModuleMethodManifest[] {
  return [...names.map((id): ModuleMethodManifest => ({ id, kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false,
      ...(id === 'readNodeStatuses' ? {} : { required: ['nodeId'] }), properties: {
        executionId: { type: 'string', minLength: 1 }, workflowId: { type: 'string', minLength: 1 },
        ...(id === 'readNodeStatuses' ? {} : { nodeId: { type: 'string', minLength: 1 } }),
      } },
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
    readNodeStatuses: { parse: parseIdentity, invoke: async (_context, input) => port.nodeStatuses(input as TradewindReadIdentity) },
    readNodeStatus: node((nodeId, identity) => port.nodeStatus(nodeId, identity)),
    readNodeSnapshot: node((nodeId, identity) => port.nodeSnapshot(nodeId, identity)),
    readMeetingStatus: node((nodeId, identity) => port.meetingStatus(nodeId, identity)),
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

function node(invoke: (nodeId: string, identity: TradewindReadIdentity) => Promise<unknown> | unknown): ModuleMethodHandler {
  return { parse: parseNode,
    invoke: async (_context, input) => {
      const { nodeId, ...identity } = input as ReturnType<typeof parseNode>;
      return invoke(nodeId, identity);
    } };
}

function parseIdentity(value: unknown): TradewindReadIdentity {
  const item = record(value);
  if (Object.keys(item).some(key => key !== 'executionId' && key !== 'workflowId')) throw invalid();
  return { ...(item.executionId === undefined ? {} : { executionId: identifier(item.executionId) }),
    ...(item.workflowId === undefined ? {} : { workflowId: identifier(item.workflowId) }) };
}

function parseNode(value: unknown): { nodeId: string } & TradewindReadIdentity {
  const item = record(value);
  const { nodeId, ...identity } = item;
  return { nodeId: identifier(nodeId), ...parseIdentity(identity) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw frameworkError({ code: 'TRADEWIND_READ_INPUT_INVALID', kind: 'validation',
    message: '信风读取参数无效', source: 'tradewind.read', retryable: false });
}
