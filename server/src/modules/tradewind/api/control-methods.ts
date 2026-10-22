import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  AgentToolManifest, ModuleMethodHandler, ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { agentToolOutput } from '../../../engine/collaboration/contracts.js';
import type { RoundCommand, TradewindCommands, TradewindStartCommand } from '../application/execution-commands.js';

export function tradewindControlManifests(): ModuleMethodManifest[] {
  return [
    command('startWorkflow', 'execute', startSchema(), 'operation', {
      name: 'start_workflow', description: '启动已保存的信风工作流。默认 manual 交互运行；使用循环档案时必须显式设置 mode:auto 并填写真实 profileId。',
    }),
    command('stopWorkflow', 'intervene', executionSchema(), 'inline', {
      name: 'stop_workflow', description: '停止指定 executionId 的信风执行及其循环。不会停止其他工作流；仅在请求明确要求停止时使用，完成后再读取运行记录。',
    }),
    command('submitHumanGate', 'intervene', humanGateSchema(), 'inline'),
    command('abortNodeRound', 'intervene', roundSchema(true), 'inline', {
      name: 'abort_workflow_node_round', description: '中止指定执行、节点和 runId 的普通发话轮。信封或联络交付轮须使用暂停工具；不会停止整个工作流。先读取节点当前轮次。',
    }),
    command('pauseNodeRound', 'intervene', roundSchema(true), 'inline', {
      name: 'pause_workflow_node_round', description: '暂停指定执行、节点和 runId 的信封或联络轮，扣住交付，不派发下游。普通发话轮不能暂停；返回表示已接受暂停，随后读取节点确认 paused 和 pausedRunId。',
    }),
    command('resumeNodeRound', 'intervene', roundSchema(true), 'inline', {
      name: 'resume_workflow_node_round', description: '恢复指定 executionId、nodeId 已暂停的交付轮，runId 必须填写读取到的 pausedRunId。在既有上下文重跑本轮，可能重做工具动作；不是断点续传，也不会恢复其他节点。',
    }),
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
    abortNodeRound: roundHandler(parseRound, commands.abortNodeRound, 'abort'),
    pauseNodeRound: roundHandler(parseRound, commands.pauseNodeRound, 'pause'),
    resumeNodeRound: {
      parse: parseExecutionNode,
      invoke: async (context, input) => {
        const command = input as { executionId: string; nodeId: string; runId?: string };
        if (context.actor.type === 'agent' && !command.runId) throw invalidInput();
        const receipt = await commands.resumeNodeRound(command);
        return context.actor.type === 'agent'
          ? { accepted: true, action: 'resume', ...command } : receipt;
      },
    },
    abortMeetingRound: roundHandler(parseRound, commands.abortMeetingRound),
    sendNodeMessage: {
      parse: parseNodeMessage,
      invoke: (context, input) => commands.sendNodeMessage(
        input as { executionId: string; nodeId: string; message: string },
        { type: context.actor.type, id: context.actor.id },
      ),
    },
  };
}

function roundHandler(
  parse: (value: unknown) => RoundCommand,
  invoke: (input: RoundCommand) => Promise<unknown>,
  agentAction?: 'abort' | 'pause',
): ModuleMethodHandler {
  return { parse, invoke: async (context, input) => {
    const command = input as RoundCommand;
    if (agentAction && context.actor.type === 'agent' && !command.executionId) throw invalidInput();
    const receipt = await invoke(command);
    return agentAction && context.actor.type === 'agent'
      ? { accepted: true, action: agentAction, ...command } : receipt;
  } };
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
  if (profileId && mode !== 'auto') throw frameworkError({
    code: 'TRADEWIND_PROFILE_MODE_INVALID', kind: 'validation',
    message: '使用循环档案时必须显式选择 auto 无人值守模式', source: 'tradewind.control', retryable: false,
  });
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

function parseRound(value: unknown): RoundCommand {
  if (!isRecord(value) || Object.keys(value).some(key => !['executionId', 'nodeId', 'runId'].includes(key))) {
    throw invalidInput();
  }
  return { nodeId: text(value.nodeId), runId: text(value.runId),
    ...(value.executionId === undefined ? {} : { executionId: text(value.executionId) }) };
}

function parseExecution(value: unknown): { executionId: string } {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'executionId')) throw invalidInput();
  return { executionId: text(value.executionId) };
}

function parseExecutionNode(value: unknown): { executionId: string; nodeId: string; runId?: string } {
  if (!isRecord(value) || Object.keys(value).some(
    key => key !== 'executionId' && key !== 'nodeId' && key !== 'runId',
  )) throw invalidInput();
  return { executionId: text(value.executionId), nodeId: text(value.nodeId),
    ...(value.runId === undefined ? {} : { runId: text(value.runId) }) };
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
  required: ['workflowId'], allOf: [{ if: { required: ['profileId'] },
    then: { required: ['mode'], properties: { mode: { const: 'auto' } } } }], properties: {
    workflowId: { type: 'string', minLength: 1 },
    initialInput: { type: 'string' }, mode: { enum: ['manual', 'auto'] }, profileId: { type: 'string' },
  } }; }
function humanGateSchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId', 'nodeId'], properties: {
    executionId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 },
    content: { type: 'string' },
  },
}; }
function roundSchema(scoped = false) { return { type: 'object', additionalProperties: false,
  required: scoped ? ['executionId', 'nodeId', 'runId'] : ['nodeId', 'runId'], properties: {
    executionId: { type: 'string', minLength: 1 },
    nodeId: { type: 'string', minLength: 1 }, runId: { type: 'string', minLength: 1 },
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
