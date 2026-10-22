import { SuspendSignal, type ToolCaller, type ToolCallOutcome } from '../shared/react/native-loop.js';
import type { SandboxLevel } from '../shared/sandbox-prompt.js';
import { execToolUnifiedOutcome } from '../shared/exec-tool.js';
import { legacyToolArguments, type ToolArguments } from '../shared/tool-arguments.js';
import { execMemoryTool, MEMORY_TOOL_NAMES } from '../shared/agent-memory.js';
import { execTaskBoard, taskboardFile } from '../shared/taskboard.js';
import {
  executeBackgroundExecutionToolOutcome, isBackgroundExecutionTool,
} from '../shared/background-execution-tools.js';
import {
  prepareToolRegistration, type ToolRegistrationProposal,
} from '../shared/tool-registration.js';
import { readAgentCollaborationSnapshot } from '../collaboration/agent-gateway.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';
import { executeDelegateToolOutcome, type DelegateToolEvent } from './delegate-tool.js';
import { FileChangeLedger } from './file-change-ledger.js';
import { ToolDispatchRegistry, type ToolDispatchHandler } from './tool-dispatch-registry.js';

type ToolArgs = Record<string, string>;
type DispatchResult = string | ToolCallOutcome;
type ToolEvent = DelegateToolEvent
  | { type: 'tool-call'; tool: string; args: ToolArguments }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown };

export interface SessionToolExtension {
  definitions: ToolDef[];
  guideDefinitions?: ToolDef[];
  call(
    name: string, args: ToolArgs, signal?: AbortSignal,
  ): Promise<string | { result: string; meta?: unknown }>;
}

export interface SessionToolDispatcherInput {
  toolMediaScope?: import('../shared/tool-media-access.js').ToolMediaScope;
  dataDir: string;
  agentId: string;
  model: string;
  workspace: string;
  sandboxLevel: SandboxLevel;
  signal: AbortSignal;
  guideToolDefs: ToolDef[];
  ledger: FileChangeLedger;
  emit(event: ToolEvent): void;
  setPendingRegistration(proposal: ToolRegistrationProposal): void;
  sessionId?: string;
  mainAgent?: boolean;
  allowAsk?: boolean;
  allowDelegate?: boolean;
  memberTools?: string[];
  extension?: SessionToolExtension;
  interceptTool?: (tool: string, args: ToolArgs) => string | null;
}

export function createSessionToolCaller(input: SessionToolDispatcherInput): ToolCaller {
  const registry = new ToolDispatchRegistry<ToolArgs, DispatchResult>(buildHandlers(input));
  const extensionNames = new Set(input.extension?.definitions.map(tool => tool.name) ?? []);
  return { call: async (tool, rawArgs) => {
    const args = legacyToolArguments(rawArgs);
    if (input.memberTools && !input.memberTools.includes(tool)) throw new Error('TEAM_TOOL_NOT_ALLOWED');
    if (!extensionNames.has(tool)) {
      const intercepted = input.interceptTool?.(tool, args);
      if (intercepted !== undefined && intercepted !== null) {
        emitResult(input, tool, args, intercepted, true);
        return intercepted;
      }
    }
    return registry.dispatch(tool, args, name => executeDefault(input, name, rawArgs));
  } };
}

function buildHandlers(input: SessionToolDispatcherInput): ToolDispatchHandler<ToolArgs, DispatchResult>[] {
  const handlers: ToolDispatchHandler<ToolArgs, DispatchResult>[] = [];
  if (input.extension) handlers.push({
    id: 'extension',
    matches: tool => input.extension!.definitions.some(definition => definition.name === tool),
    execute: (tool, args) => executeExtension(input, tool, args),
  });
  handlers.push(
    exact('ask', args => executeAsk(input, args)),
    exact('register_tool', args => executeRegistration(input, args)),
    exact('delegate', args => executeDelegate(input, args)),
    matching('background', isBackgroundExecutionTool,
      (tool, args) => executeBackground(input, tool, args)),
    matching('memory', tool => (MEMORY_TOOL_NAMES as readonly string[]).includes(tool),
      (tool, args) => executeMemory(input, tool, args)),
    exact('task_board', args => executeBoard(input, args)),
    exact('framework_status', args => executeFrameworkStatus(input, args)),
    exact('framework_guide', args => executeFrameworkGuide(input, args)),
    exact('review_changes', args => executeReview(input, args)),
  );
  return handlers;
}

function exact(
  name: string, execute: (args: ToolArgs) => Promise<DispatchResult>,
): ToolDispatchHandler<ToolArgs, DispatchResult> {
  return { id: name, matches: tool => tool === name, execute: (_tool, args) => execute(args) };
}

function matching(
  id: string, matches: (tool: string) => boolean,
  execute: (tool: string, args: ToolArgs) => Promise<DispatchResult>,
): ToolDispatchHandler<ToolArgs, DispatchResult> {
  return { id, matches, execute };
}

async function executeExtension(
  input: SessionToolDispatcherInput, tool: string, args: ToolArgs,
): Promise<string> {
  input.emit({ type: 'tool-call', tool, args });
  try {
    const output = await input.extension!.call(tool, args, input.signal);
    const result = typeof output === 'string' ? output : output.result;
    const meta = typeof output === 'string' ? undefined : output.meta;
    input.emit({ type: 'tool-result', tool, result, ok: true, ...(meta ? { meta } : {}) });
    return result;
  } catch (error) {
    input.emit({ type: 'tool-result', tool, result: message(error), ok: false });
    throw error;
  }
}

async function executeAsk(input: SessionToolDispatcherInput, args: ToolArgs): Promise<DispatchResult> {
  if (input.allowAsk === false) return failed(input, 'ask', args,
    '当前入口不支持 ask，请根据已有信息继续完成任务。');
  let options: string[] | undefined;
  if (args.options) {
    try { options = JSON.parse(args.options); } catch {}
  }
  throw new SuspendSignal(args.question || '需要你的确认', options);
}

async function executeRegistration(
  input: SessionToolDispatcherInput, args: ToolArgs,
): Promise<DispatchResult> {
  if (!input.sessionId) return failed(input, 'register_tool', args,
    '工具注册失败：当前入口不支持人类确认。请改用季风会话或气旋工位私聊。');
  try {
    const proposal = await prepareToolRegistration(input.dataDir, args);
    input.setPendingRegistration(proposal);
    throw new SuspendSignal(
      `注册全局工具「${proposal.tool.name}」？\n${proposal.tool.description}\n执行生命周期：${proposal.tool.executionMode === 'detachable' ? '允许后台化' : '同步完成'}`,
      ['注册', '取消'],
    );
  } catch (error) {
    if (error instanceof SuspendSignal) throw error;
    return failed(input, 'register_tool', args, `工具注册失败：${message(error)}`);
  }
}

async function executeDelegate(input: SessionToolDispatcherInput, args: ToolArgs): Promise<DispatchResult> {
  if (input.allowDelegate === false) return failed(input, 'delegate', args,
    '当前入口不支持 delegate，请在本轮内直接完成任务。');
  return executeDelegateToolOutcome({ ...input, args, emit: input.emit });
}

async function executeBackground(
  input: SessionToolDispatcherInput, tool: string, args: ToolArgs,
): Promise<DispatchResult> {
  if (!isBackgroundExecutionTool(tool)) throw new Error('BACKGROUND_TOOL_UNKNOWN');
  input.emit({ type: 'tool-call', tool, args });
  if (!input.sessionId) return failedResult(input, tool, '操作失败：当前入口没有可交互会话身份。');
  const outcome = await executeBackgroundExecutionToolOutcome({
    tool, args, scope: 'conversation', ownerId: input.sessionId,
  });
  input.emit({ type: 'tool-result', tool, ...outcome });
  return outcome;
}

async function executeMemory(
  input: SessionToolDispatcherInput, tool: string, args: ToolArgs,
): Promise<DispatchResult> {
  input.emit({ type: 'tool-call', tool, args });
  try {
    const result = await execMemoryTool(input.dataDir, input.agentId, 'conversation', tool, args);
    input.emit({ type: 'tool-result', tool, result, ok: true });
    return result;
  } catch (error) {
    return failedResult(input, tool, `记忆工具执行失败: ${message(error)}`);
  }
}

async function executeBoard(input: SessionToolDispatcherInput, args: ToolArgs): Promise<DispatchResult> {
  input.emit({ type: 'tool-call', tool: 'task_board', args });
  const file = input.sessionId
    ? taskboardFile(input.dataDir, input.agentId, input.sessionId) : null;
  const outcome = await execTaskBoard(file, args);
  input.emit({ type: 'tool-result', tool: 'task_board', ...outcome });
  return outcome;
}

async function executeFrameworkStatus(
  input: SessionToolDispatcherInput, args: ToolArgs,
): Promise<DispatchResult> {
  input.emit({ type: 'tool-call', tool: 'framework_status', args });
  if (!input.mainAgent || !input.sessionId) return failedResult(input, 'framework_status',
    '协作状态读取失败：当前入口未开放协作总览能力。');
  try {
    const snapshot = await readAgentCollaborationSnapshot({
      view: 'summary', limit: 10, maxTextChars: 2_000, maxTextLines: 40,
    }, { agentId: input.agentId, sessionId: input.sessionId, signal: input.signal });
    const result = JSON.stringify(snapshot);
    input.emit({ type: 'tool-result', tool: 'framework_status', result, ok: true });
    return result;
  } catch (error) {
    return failedResult(input, 'framework_status', `协作状态读取失败：${message(error)}`);
  }
}

async function executeFrameworkGuide(
  input: SessionToolDispatcherInput, args: ToolArgs,
): Promise<DispatchResult> {
  input.emit({ type: 'tool-call', tool: 'framework_guide', args });
  const outcome = executeFrameworkGuideTool({
    mainAgent: !!input.mainAgent, dataDir: input.dataDir, agentId: input.agentId,
    sessionId: input.sessionId, args, toolDefs: input.guideToolDefs,
  });
  input.emit({ type: 'tool-result', tool: 'framework_guide', ...outcome });
  return outcome;
}

async function executeReview(input: SessionToolDispatcherInput, args: ToolArgs): Promise<string> {
  const result = input.ledger.render();
  emitResult(input, 'review_changes', args, result, true);
  return result;
}

async function executeDefault(
  input: SessionToolDispatcherInput, tool: string, args: ToolArguments,
): Promise<DispatchResult> {
  input.emit({ type: 'tool-call', tool, args });
  try {
    let meta: unknown;
    const outcome = await execToolUnifiedOutcome({
      tool, args, agentId: input.agentId, workspaceDir: input.workspace,
      mediaAccess: input.toolMediaScope ? { dataDir: input.dataDir, ...input.toolMediaScope }
        : input.sessionId ? { dataDir: input.dataDir, feature: 'monsoon',
          target: { agentId: input.agentId, sessionId: input.sessionId } } : undefined,
      sandboxLevel: input.sandboxLevel, signal: input.signal,
      onMeta: value => { meta = value; },
      observation: input.sessionId
        ? { scope: 'conversation', ownerId: input.sessionId } : undefined,
    });
    input.ledger.record(meta);
    input.emit({ type: 'tool-result', tool, ...outcome, meta });
    return { ...outcome, meta };
  } catch (error) {
    return failedResult(input, tool, `工具执行失败: ${message(error)}`);
  }
}

function failed(
  input: SessionToolDispatcherInput, tool: string, args: ToolArgs, result: string,
): ToolCallOutcome {
  input.emit({ type: 'tool-call', tool, args });
  return failedResult(input, tool, result);
}

function failedResult(input: SessionToolDispatcherInput, tool: string, result: string): ToolCallOutcome {
  input.emit({ type: 'tool-result', tool, result, ok: false });
  return { result, ok: false };
}

function emitResult(
  input: SessionToolDispatcherInput, tool: string, args: ToolArgs, result: string, ok: boolean,
): void {
  input.emit({ type: 'tool-call', tool, args });
  input.emit({ type: 'tool-result', tool, result, ok });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
