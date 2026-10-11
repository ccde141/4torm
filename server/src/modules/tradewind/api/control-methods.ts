import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  AgentToolManifest, ModuleMethodHandler, ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { agentToolOutput } from '../../../engine/collaboration/contracts.js';
import type { TradewindCommands, TradewindStartCommand } from '../application/execution-commands.js';

export function tradewindControlManifests(): ModuleMethodManifest[] {
  return [
    command('startWorkflow', 'execute', startSchema(), 'operation', {
      name: 'start_workflow', description: '启动一个已经保存的信风工作流。',
    }),
    command('stopWorkflow', 'intervene', executionSchema(), 'inline'),
    command('submitHumanGate', 'intervene', humanGateSchema(), 'inline'),
    command('abortNodeRound', 'intervene', roundSchema(), 'inline'),
    command('pauseNodeRound', 'intervene', roundSchema(), 'inline'),
    command('resumeNodeRound', 'intervene', nodeSchema(), 'inline'),
    command('abortMeetingRound', 'intervene', roundSchema(), 'inline'),
    command('sendNodeMessage', 'intervene', nodeMessageSchema(), 'inline', {
      name: 'message_workflow_node',
      description: '给当前信风执行中的 Agent 节点发话。返回已接收仅表示入队；随后读取节点或检查执行状态确认处理结果。',
    }),
  ];
}

export function tradewindControlHandlers(commands: TradewindCommands): Record<string, ModuleMethodHandler> {
  return {
    startWorkflow: {
      parse: parseStart,
      invoke: async (context, input) => {
        const started = await commands.start(input as TradewindStartCommand, actorFrom(context));
        const receipt = operationReceipt(started);
        return context.actor.type === 'agent'
          ? agentToolOutput(receipt, { workflowExecution: started })
          : receipt;
      },
    },
    stopWorkflow: {
      parse: parseExecution,
      invoke: (_context, input) => commands.stop(input as { executionId: string }),
    },
    submitHumanGate: {
      parse: parseHumanGate,
      invoke: (_context, input) => commands.submitHumanGate(
        input as { executionId: string; nodeId: string; content?: string },
      ),
    },
    abortNodeRound: roundHandler(parseRound, commands.abortNodeRound),
    pauseNodeRound: roundHandler(parseRound, commands.pauseNodeRound),
    resumeNodeRound: {
      parse: parseExecutionNode,
      invoke: (_context, input) => commands.resumeNodeRound(
        input as { executionId: string; nodeId: string },
      ),
    },
    abortMeetingRound: roundHandler(parseRound, commands.abortMeetingRound),
    sendNodeMessage: {
      parse: parseNodeMessage,
      invoke: (_context, input) => commands.sendNodeMessage(
        input as { executionId: string; nodeId: string; message: string },
      ),
    },
  };
}

function roundHandler(
  parse: (value: unknown) => { nodeId: string; runId: string },
  invoke: (input: { nodeId: string; runId: string }) => Promise<unknown>,
): ModuleMethodHandler {
  return { parse, invoke: (_context, input) => invoke(input as { nodeId: string; runId: string }) };
}

function actorFrom(context: Parameters<ModuleMethodHandler['invoke']>[0]) {
  if (context.actor.type === 'system') throw frameworkError({
    code: 'TRADEWIND_SYSTEM_START_UNSUPPORTED', kind: 'permission',
    message: '信风尚未定义系统身份启动语义', source: 'tradewind.control', retryable: false,
  });
  return { type: context.actor.type, id: context.actor.id,
    ...(context.actor.type === 'agent' ? { sessionId: context.requestId } : {}),
  };
}

function command(
  id: string,
  permission: ModuleMethodManifest['permission'],
  inputSchema: Record<string, unknown>,
  mode: ModuleMethodManifest['output']['mode'],
  agentTool?: AgentToolManifest,
): ModuleMethodManifest {
  return {
    id, kind: 'command', permission,
    audiences: agentTool ? ['human', 'agent', 'internal'] : ['human', 'internal'],
    inputSchema, output: { mode }, ...(agentTool ? { agentTool } : {}),
  };
}

function operationReceipt(receipt: Awaited<ReturnType<TradewindCommands['start']>>) {
  return { operationId: receipt.workflowId, runId: receipt.executionId, ...receipt };
}

function parseStart(value: unknown): TradewindStartCommand {
  if (!isRecord(value)) throw invalidInput();
  const allowed = new Set(['workflowId', 'initialInput', 'mode', 'profileId']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalidInput();
  const workflowId = text(value.workflowId);
  const mode = value.mode === undefined ? undefined : value.mode;
  if (mode !== undefined && mode !== 'manual' && mode !== 'auto') throw invalidInput();
  const initialInput = optionalText(value.initialInput);
  const profileId = optionalText(value.profileId);
  return { workflowId,
    ...(initialInput ? { initialInput } : {}), ...(mode ? { mode } : {}),
    ...(profileId ? { profileId } : {}),
  };
}

function parseHumanGate(value: unknown): { executionId: string; nodeId: string; content?: string } {
  if (!isRecord(value) || Object.keys(value).some(
    key => key !== 'executionId' && key !== 'nodeId' && key !== 'content',
  )) {
    throw invalidInput();
  }
  const content = optionalText(value.content);
  return { executionId: text(value.executionId), nodeId: text(value.nodeId),
    ...(content ? { content } : {}) };
}

function parseRound(value: unknown): { nodeId: string; runId: string } {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'nodeId' && key !== 'runId')) {
    throw invalidInput();
  }
  return { nodeId: text(value.nodeId), runId: text(value.runId) };
}

function parseExecution(value: unknown): { executionId: string } {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'executionId')) throw invalidInput();
  return { executionId: text(value.executionId) };
}

function parseExecutionNode(value: unknown): { executionId: string; nodeId: string } {
  if (!isRecord(value) || Object.keys(value).some(
    key => key !== 'executionId' && key !== 'nodeId',
  )) throw invalidInput();
  return { executionId: text(value.executionId), nodeId: text(value.nodeId) };
}

function parseNodeMessage(value: unknown): { executionId: string; nodeId: string; message: string } {
  if (!isRecord(value) || Object.keys(value).some(
    key => key !== 'executionId' && key !== 'nodeId' && key !== 'message',
  )) throw invalidInput();
  const message = text(value.message);
  if (message.length > 50_000) throw invalidInput();
  return { executionId: text(value.executionId), nodeId: text(value.nodeId), message };
}

function parseEmpty(value: unknown): Record<string, never> {
  if (!isRecord(value) || Object.keys(value).length > 0) throw invalidInput();
  return {};
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidInput();
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidInput();
  return value.trim() || undefined;
}

function invalidInput() {
  return frameworkError({ code: 'TRADEWIND_CONTROL_INPUT_INVALID', kind: 'validation',
    message: '信风控制参数无效', source: 'tradewind.module', retryable: false });
}

function executionSchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId'], properties: { executionId: { type: 'string', minLength: 1 } },
}; }
function startSchema() { return { type: 'object', additionalProperties: false,
  required: ['workflowId'], properties: {
    workflowId: { type: 'string', minLength: 1 },
    initialInput: { type: 'string' }, mode: { enum: ['manual', 'auto'] }, profileId: { type: 'string' },
  } }; }
function humanGateSchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId', 'nodeId'], properties: {
    executionId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 },
    content: { type: 'string' },
  },
}; }
function roundSchema() { return { type: 'object', additionalProperties: false,
  required: ['nodeId', 'runId'], properties: {
    nodeId: { type: 'string', minLength: 1 }, runId: { type: 'string', minLength: 1 },
  },
}; }
function nodeSchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId', 'nodeId'], properties: {
    executionId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 },
  },
}; }
function nodeMessageSchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId', 'nodeId', 'message'], properties: {
    executionId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1, maxLength: 50_000 },
  },
}; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
