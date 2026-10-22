import { randomUUID } from 'node:crypto';
import { loadAgent } from '../shared/agent-loader.js';
import { loadAgentToolDefs, type ToolDef } from '../shared/tool-defs-loader.js';
import { callLLM, resolveNativeMode } from '../shared/llm-bridge.js';
import { execToolUnifiedOutcome } from '../shared/exec-tool.js';
import { legacyToolArguments } from '../shared/tool-arguments.js';
import { execTaskBoard } from '../shared/taskboard.js';
import { buildMemoryToolDefs, execMemoryTool, recallMemory, MEMORY_TOOL_NAMES } from '../shared/agent-memory.js';
import { isFrameworkCapabilityToolName } from '../../shared/framework-capability.js';
import { SuspendSignal, runReActLoopNative, type LLMCaller, type ToolCaller } from '../shared/react/native-loop.js';
import { runReActLoop } from '../shared/react/text-loop.js';
import type { ContextMessage } from '../shared/types.js';
import { buildSeatVirtualToolDefs } from './virtual-tools.js';
import { buildSupervisorPrompt } from './supervisor-prompt.js';
import { createSupervisorCompactionCaller } from './supervisor-compaction.js';
import { toSeatProgressEvent } from './loop-event-forwarder.js';
import { recordSeatAssistantResult } from './seat-reasoning.js';
import { hasSupervisorReceiptEvidence } from './supervisor-information.js';
import { workshopWorkspace } from './paths.js';
import { supervisorTools } from './supervisor-tools.js';
import { consumeSupervisorInformation, loadSupervisor, mutateSupervisor, readPendingSupervisorInformation,
  hasEstablishedSupervisorGoal, supervisorTaskboardFile, type SupervisorData,
  type SupervisorGoalOrigin, type SupervisorMessage } from './supervisor-store.js';

const GLOBAL_ACTIONS = new Set(['framework_status', 'inspect_operation', 'wait_operation',
  'find_operation_records', 'read_operation_record', 'register_tool', 'team_start', 'team_create',
  'team_dispatch', 'team_read', 'team_wait', 'team_ack', 'team_review', 'team_dismiss']);
const MEMORY_TOOL: ToolDef = { name: 'supervisor_memory',
  description: '按需读取或更新当前主管的项目记忆。write更新同一id；expectedRevision来自list/read。',
  parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: ['list', 'read', 'write'] }, id: { type: 'string' },
    title: { type: 'string', maxLength: 200 }, content: { type: 'string', maxLength: 50_000 },
    expectedRevision: { type: 'integer', minimum: 0 },
  } } };
function forbidden(name: string): boolean { return GLOBAL_ACTIONS.has(name) || isFrameworkCapabilityToolName(name); }

export type SupervisorTurnInput = { mode: 'chat' | 'resume' | 'information'; text: string }
  | { mode: 'delegated'; text: string; origin: Extract<SupervisorGoalOrigin, { kind: 'agent' }> };

export async function runSupervisorTurn(dataDir: string, workshopId: string, input: SupervisorTurnInput,
  onEvent: (event: unknown) => void, signal?: AbortSignal) {
  const supervisor = await loadSupervisor(dataDir, workshopId);
  if (!supervisor.agentId) throw new Error('请先选择主管 Agent');
  const agent = await loadAgent(dataDir, supervisor.agentId);
  if (!agent) throw new Error('主管绑定的 Agent 不存在');
  if (input.mode === 'information' && (!hasEstablishedSupervisorGoal(supervisor) || supervisor.followUpPaused)) {
    throw new Error('主管当前没有可自动接续的已确认目标');
  }
  if (input.mode !== 'resume' && supervisor.pending) throw new Error('主管正在等待人类回答');
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const scoped = supervisorTools(dataDir);
  const definitions = [
    ...(await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode)).filter(tool => !forbidden(tool.name)),
    ...buildSeatVirtualToolDefs({ allowAsk: true, allowDelegate: false }).filter(tool => tool.name !== 'bulletin'),
    MEMORY_TOOL, ...scoped.definitions,
    ...buildMemoryToolDefs(),
  ];
  const tools = [...new Map(definitions.map(tool => [tool.name, tool])).values()];
  const messages: SupervisorMessage[] = [
    { role: 'system', content: [buildSupervisorPrompt(dataDir, workshopId, supervisor, agent, tools, native),
      await recallMemory(dataDir, agent.id, input.text),
      '项目资料和纠正写入 supervisor_memory；绑定 Agent 的 memory_list/read/write 用于跨项目通用经验，勿将本项目个例泛化到所有项目。'].filter(Boolean).join('\n\n') },
    ...supervisor.messages,
  ];
  applyInput(supervisor, messages, input);
  if (input.mode !== 'information') {
    if (input.mode === 'delegated') {
      supervisor.goalOrigin = input.origin;
      supervisor.humanIntentEstablished = false;
    } else if (input.mode === 'chat' || !hasEstablishedSupervisorGoal(supervisor)) {
      supervisor.goalOrigin = { kind: 'human' };
      supervisor.humanIntentEstablished = true;
    }
  }
  let clearNotice = input.mode !== 'information';
  const ingest = async () => {
    const incoming = await readPendingSupervisorInformation(dataDir, workshopId);
    const known = new Set(messages.map(message => message.supervisorInboxId));
    const consumed: string[] = [];
    let added = 0;
    for (const item of incoming) {
      if (!known.has(item.id) && !hasSupervisorReceiptEvidence(messages, item)) {
        if (added === 20) break;
        messages.push({ role: 'user', supervisorInboxId: item.id, supervisorSourceTitle: item.sourceTitle,
          content: `[协作信息：${item.sourceTitle}；${item.createdAt}。仅为工作室协作资料，不替代人类目标。]\n${item.content}` });
        added++;
      }
      consumed.push(item.id);
    }
    await persistMessages(dataDir, workshopId, messages, supervisor, signal, clearNotice);
    clearNotice = false;
    await consumeSupervisorInformation(dataDir, workshopId, consumed);
    return added;
  };
  await ingest();
  const generatedContextStart = messages.length;
  let reasoning = '';
  const internalNotices = new Map<number, string>();
  const markInternalNotices = () => {
    for (const [index, content] of internalNotices) {
      if (messages[index]?.role === 'user' && messages[index].content === content) messages[index].supervisorInternal = true;
    }
  };
  onEvent({ type: 'input-accepted' });
  const llm: LLMCaller = { call: (context, _options, onChunk, abort, defs, onReasoning, onToolProgress) => {
    markInternalNotices();
    return callLLM({
    dataDir, fullModelKey: agent.model, messages: context, options: { temperature: agent.temperature },
    onChunk, signal: abort, tools: defs, onReasoning, onToolProgress,
    });
  } };
  const caller: ToolCaller = { call: async (name, rawArgs) => {
    const args = legacyToolArguments(rawArgs);
    if (name === 'ask') {
      let options: string[] | undefined;
      if (args.options) { try { options = JSON.parse(args.options); } catch { /* Free text remains available. */ } }
      throw new SuspendSignal(args.question || '需要你的确认', options);
    }
    onEvent({ type: 'tool-call', tool: name, args: rawArgs });
    let outcome;
    try {
      if (name === 'task_board') outcome = await execTaskBoard(supervisorTaskboardFile(dataDir, workshopId), args);
      else if (name === 'supervisor_memory') outcome = await memory(dataDir, workshopId, args);
      else if ((MEMORY_TOOL_NAMES as readonly string[]).includes(name)) outcome = {
        ok: true, result: await execMemoryTool(dataDir, agent.id, 'cyclone', name, args),
      };
      else if (scoped.definitions.some(tool => tool.name === name)) outcome = await scoped.call(workshopId, name, args, signal);
      else if (forbidden(name)) outcome = { result: '此调用不属于当前工作室的主管权限', ok: false };
      else outcome = await execToolUnifiedOutcome({ tool: name, args: rawArgs, agentId: agent.id,
        mediaAccess: { dataDir, feature: 'cyclone', target: { workshopId, kind: 'supervisor', targetId: 'supervisor' } },
        workspaceDir: workshopWorkspace(dataDir, workshopId), sandboxLevel: agent.sandboxLevel, signal,
        observation: { scope: 'cyclone', ownerId: `${workshopId}:supervisor` } });
    } catch (error) { outcome = { result: (error as Error).message, ok: false }; }
    onEvent({ type: 'tool-result', tool: name, ...outcome });
    return outcome;
  } };
  const measured = createSupervisorCompactionCaller({ dataDir, workshopId, supervisor, agent,
    messages, llm, onEvent });
  const params = { llm: measured, messages: messages as ContextMessage[], tools: caller, toolDefs: tools,
    allowedTools: tools.map(tool => tool.name),
    onToolError: (error: unknown) => error instanceof SuspendSignal
      ? { reason: 'ask', question: error.question, options: error.options } : null,
    signal, beforeFinish: async () => {
      if (!await ingest()) return [];
      const notice = '刚收到新的工作室协作信息，请核实必要的后续事项，再向人类收尾。';
      internalNotices.set(messages.length + (native ? 1 : 0), notice);
      return [notice];
    },
    onEvent: (event: Parameters<typeof toSeatProgressEvent>[0]) => {
      if (event.type === 'reasoning') reasoning += event.chunk;
      const translated = toSeatProgressEvent(event);
      if (translated && event.type !== 'tool-call' && event.type !== 'tool-result') onEvent(translated);
    } };
  const result = native ? await runReActLoopNative(params) : await runReActLoop(params);
  if (!result.suspended) recordSeatAssistantResult(messages, result.content, reasoning, generatedContextStart);
  if (result.suspended) {
    const last = [...messages].reverse().find(message => message.role === 'assistant' && message.toolCalls?.length);
    supervisor.pending = { ...result.suspended, native,
      pendingToolCallId: result.suspended.pendingToolCallId ?? last?.toolCalls?.find(call => call.name === 'ask')?.id };
    onEvent({ type: 'ask', ...result.suspended });
  }
  if (!result.suspended) supervisor.pending = undefined;
  markInternalNotices();
  await persistMessages(dataDir, workshopId, messages, supervisor);
  if (result.termination.status === 'succeeded') onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
  return result;
}
function applyInput(supervisor: SupervisorData, messages: SupervisorMessage[], input: SupervisorTurnInput): void {
  if (input.mode === 'information') return;
  if (input.mode === 'resume') {
    const pending = supervisor.pending;
    if (!pending) throw new Error('主管没有等待回答的问题');
    messages.push(pending.native && pending.pendingToolCallId
      ? { role: 'tool', toolCallId: pending.pendingToolCallId, content: input.text }
      : { role: 'user', content: `人类回答：${input.text}` });
    supervisor.pending = undefined;
  } else if (input.mode === 'delegated') messages.push({ role: 'user',
    supervisorGoalOrigin: input.origin,
    content: `[委托目标：Agent ${input.origin.agentId}；会话 ${input.origin.sessionId}。这是框架 Agent 的委托，不是人类直接发言。]\n${input.text}` });
  else messages.push({ role: 'user', content: input.text, supervisorGoalOrigin: { kind: 'human' } });
}
async function persistMessages(dataDir: string, workshopId: string, messages: SupervisorMessage[],
  supervisor: SupervisorData, signal?: AbortSignal, clearNotice = false): Promise<void> {
  await mutateSupervisor(dataDir, workshopId, current => {
    current.messages = messages.slice(1); current.pending = supervisor.pending;
    current.goalOrigin = supervisor.goalOrigin;
    current.humanIntentEstablished = supervisor.humanIntentEstablished;
    if (clearNotice) current.compactionNotice = undefined;
    if (supervisor.tokenUsage) current.tokenUsage = supervisor.tokenUsage;
  }, signal);
}
async function memory(dataDir: string, workshopId: string, args: Record<string, string>) {
  const current = await loadSupervisor(dataDir, workshopId);
  if (args.action === 'list') return { ok: true, result: JSON.stringify({ revision: current.memoryRevision,
    entries: current.memory.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) }) };
  if (args.action === 'read') {
    const entry = current.memory.find(item => item.id === args.id);
    if (!entry) throw new Error('主管记忆不存在');
    return { ok: true, result: JSON.stringify({ revision: current.memoryRevision, entry }) };
  }
  if (args.action !== 'write' || !args.title?.trim() || !args.content?.trim()
    || args.title.length > 200 || args.content.length > 50_000) throw new Error('主管记忆参数无效');
  await mutateSupervisor(dataDir, workshopId, next => {
    if (Number(args.expectedRevision) !== next.memoryRevision) throw new Error('主管记忆已更新，请重新读取后合并');
    const index = args.id ? next.memory.findIndex(item => item.id === args.id) : -1;
    if (args.id && index < 0) throw new Error('主管记忆不存在');
    const entry = { id: args.id || `mem-${randomUUID()}`, title: args.title.trim(),
      content: args.content.trim(), updatedAt: new Date().toISOString() };
    if (index < 0) next.memory.push(entry); else next.memory[index] = entry;
    next.memoryRevision++;
  });
  return { ok: true, result: '主管项目记忆已保存' };
}
