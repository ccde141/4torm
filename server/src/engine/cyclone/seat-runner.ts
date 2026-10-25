import { subAgentReport } from '../shared/sub-agent-result.js';
import { SUB_AGENT_MAX_ROUNDS } from '../shared/sub-agent-budget.js';
/**
 * 气旋工位执行器 —— 无常驻实例，状态全落 SeatData 文件
 *
 * 依赖边界：只 import shared/ 与本目录模块。ReAct 算法来自 shared，
 * 工位挂起、持久化、Prompt 与工具策略仍由气旋独立维护。
 *
 * 与季风 SessionRunner 的运行方式差异：
 * - 季风 runner 是内存常驻实例，挂起态存内存；
 * - 气旋无常驻 runner，每次调用 load→run→save，挂起态写进 seat 文件的 pending 字段。
 *
 * 一次 chat：load seat+agent → 组 prompt → 跑 ReAct（native 优先 / text 退路）
 *            → ask 挂起则存 pending；否则存最终回复 → 持久化。
 */

import { callLLM, resolveNativeMode, type TokenUsage } from '../shared/llm-bridge';
import type { ToolPreparationProgress } from '../shared/tool-progress';
import type { SandboxLevel } from '../shared/sandbox-prompt';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnifiedOutcome } from '../shared/exec-tool';
import { legacyToolArguments } from '../shared/tool-arguments.js';
import {
  executeBackgroundExecutionToolOutcome,
  isBackgroundExecutionTool,
} from '../shared/background-execution-tools.js';
import { withAgentActivity } from '../shared/agent-activity.js';
import {
  runReActLoopNative,
  SuspendSignal,
  type LLMCaller,
  type ToolCaller,
  type ToolCallOutcome,
} from '../shared/react/native-loop';
import { runReActLoop } from '../shared/react/text-loop';
import type { ReActTermination } from '../shared/react/outcome.js';
import { buildSeatToolCatalog } from './seat-tool-catalog';
import { assertSeatCollaborationTool, seatCollaborationPolicy } from './seat-collaboration.js';
import { buildSeatSystemPrompt } from './seat-prompt';
import { workshopWorkspace } from './paths';
import { loadSeat, saveSeat, tryAcquireSeatLock } from './seat-store';
import { seatTaskboardFile } from './paths';
import { execTaskBoard } from '../shared/taskboard';
import { execBulletin, readBulletinSync } from './bulletin';
import { execContactOutcome } from './contact';
import { readContactCommunicationOutcome } from './contact-communication.js';
import { reportToSupervisor, withSupervisorReporting } from './supervisor-tools.js';
import { listOtherSeats, listWorkshopSeats } from './contact-registry';
import type { CycloneInputIdentity, SeatContextMessage, SeatData } from './types';
import { rememberToolImages } from '../shared/tool-media-access.js';
import path from 'node:path';
import { toSeatProgressEvent } from './loop-event-forwarder';
import { createSeatCompactionCaller } from './conversation-compaction-caller.js';
import { createSeatDispatchRecord, deliverSeatDispatchReceipts } from './seat-dispatch.js';
import { dispatchAcceptance } from './dispatch-acceptance.js';
import { kickDispatchQueue } from './dispatch-queue.js';
import { recordSeatAssistantResult } from './seat-reasoning.js';
import { executeSeatFactTool, isSeatFactTool } from './seat-fact-tools.js';
import {
  prepareToolRegistration,
  type ToolRegistrationProposal,
} from '../shared/tool-registration.js';
import { applyPendingSeatResponse } from './seat-tool-registration.js';
import {
  buildCycloneMemoryPrompt,
  executeCycloneMemoryTool,
  isCycloneMemoryTool,
  withCycloneMemoryTools,
} from './cyclone-memory.js';

/** 工位执行事件（流式推送用） */
export type SeatEvent = import('../shared/model-request-usage.js').ModelRequestUsageEvent
  | import('../shared/compaction/contracts.js').CompactionProgress
  | import('../shared/compaction/contracts.js').CompactionNotice
  | { type: 'input-accepted' }
  | { type: 'queue-wait' }
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'tool-call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown;
      toolImages?: import('../shared/types.js').ToolImageRef[] }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, unknown> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean; toolImages?: import('../shared/types.js').ToolImageRef[] }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'contact-start'; target: string; message: string; contactId: string }
  | { type: 'contact-done'; contactId: string; reply: string; ok: boolean }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'usage'; usage: TokenUsage | null }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** workspace 项目根相对路径（execToolUnified / sandbox prompt 都用相对路径） */
export function wsRelPath(dataDir: string, workshopId: string): string {
  const projectDir = path.resolve(dataDir, '..');
  return path.relative(projectDir, workshopWorkspace(dataDir, workshopId));
}

/** 构造工位的 LLM 调用器（落到 shared/callLLM） */
export function makeLLM(dataDir: string, model: string, temperature: number): LLMCaller {
  return {
    async call(msgs, _opts, onChunk, sig, tools, onReasoning, onToolProgress) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools, onReasoning, onToolProgress });
    },
  };
}

/** 执行 delegate（落到 shared/sub-agent-runner） */
async function execDelegate(
  dataDir: string, agentId: string, sandboxLevel: string,
  args: Record<string, string>, signal: AbortSignal | undefined, onEvent: (ev: SeatEvent) => void,
  mediaAccess?: import('../shared/tool-media-access.js').ToolMediaAccess,
): Promise<ToolCallOutcome> {
  const { runSubAgent } = await import('../shared/sub-agent-runner');
  const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  onEvent({ type: 'delegate-start', task: args.task || '', delegateId });
  const delegateSignal = signal ?? new AbortController().signal;
  const images: import('../shared/types.js').ToolImageRef[] = [];
  const result = await runSubAgent({
    task: args.task || '',
    context: args.context || '',
    systemPrompt: args.systemPrompt || '',
    agentId,
    dataDir,
    signal: delegateSignal,
    maxRounds: SUB_AGENT_MAX_ROUNDS,
    compactionArea: 'cycloneConversation',
    parentSandboxLevel: sandboxLevel as SandboxLevel,
    emit: (ev) => {
      if (ev.type === 'token') onEvent({ type: 'delegate-token', delegateId, content: ev.data.t });
      else if (ev.type === 'tool_call') onEvent({ type: 'delegate-tool-call', delegateId, tool: ev.data.tool, args: ev.data.args });
      else if (ev.type === 'tool_result') {
        if (ev.data.toolImages?.length) {
          images.push(...ev.data.toolImages);
          if (mediaAccess) rememberToolImages(mediaAccess, ev.data.toolImages);
        }
        onEvent({ type: 'delegate-tool-result', delegateId, tool: ev.data.tool, result: ev.data.result, ok: ev.data.ok,
          ...(ev.data.toolImages?.length ? { toolImages: ev.data.toolImages } : {}) });
      }
    },
  });
  const summary = subAgentReport(result);
  onEvent({ type: 'delegate-done', delegateId, summary, status: result.status });
  return { result: `[${result.status}] ${summary}`, ok: result.status === 'success',
    ...(images.length ? { toolImages: images.slice(-4) } : {}) };
}

/** 构造工位工具调用器：ask 抛挂起信号，delegate 派子，contact 联络其他工位，其余走 shared/execToolUnified */
export function makeToolCaller(opts: {
  dataDir: string; workshopId: string; seatId: string; seatTitle: string;
  agentId: string; sandboxLevel: string; wsDir: string;
  signal: AbortSignal | undefined; onEvent: (ev: SeatEvent) => void;
  onToolRegistration: (proposal: ToolRegistrationProposal) => void;
  onExecution: (executionId: string) => void;
}): ToolCaller {
  const {
    dataDir, workshopId, seatId, seatTitle, agentId, sandboxLevel, wsDir,
    signal, onEvent, onToolRegistration, onExecution,
  } = opts;
  const sourceTurnId = `seat-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let dispatchOrder = 0;
  return {
    async call(tool, rawArgs) {
      const args = legacyToolArguments(rawArgs);
      try { await assertSeatCollaborationTool(dataDir, workshopId, seatId, tool); }
      catch (error) {
        const result = (error as Error).message;
        onEvent({ type: 'tool-call', tool, args });
        onEvent({ type: 'tool-result', tool, result, ok: false });
        return { result, ok: false };
      }
      if (isCycloneMemoryTool(tool)) {
        onEvent({ type: 'tool-call', tool, args });
        try {
          const result = (await executeCycloneMemoryTool(dataDir, agentId, tool, args, { workshopId, seatId }))!;
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `记忆工具执行失败: ${(error as Error).message}`;
          onEvent({ type: 'tool-result', tool, result, ok: false });
          return { result, ok: false };
        }
      }
      if (isSeatFactTool(tool)) {
        onEvent({ type: 'tool-call', tool, args });
        try {
          const result = await executeSeatFactTool(dataDir, { workshopId, seatId }, tool, args);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `工位事实查询失败：${(error as Error).message}`;
          onEvent({ type: 'tool-result', tool, result, ok: false });
          return { result, ok: false };
        }
      }
      if (tool === 'contact_read' || tool === 'supervisor_message') {
        onEvent({ type: 'tool-call', tool, args });
        try {
          const outcome = tool === 'contact_read'
            ? await readContactCommunicationOutcome({ dataDir, workshopId, fromSeatId: seatId }, args)
            : await reportToSupervisor(dataDir, workshopId, seatId, args);
          onEvent({ type: 'tool-result', tool, ...outcome });
          return outcome;
        } catch (error) {
          const outcome = { result: (error as Error).message, ok: false };
          onEvent({ type: 'tool-result', tool, ...outcome }); return outcome;
        }
      }
      if (tool === 'ask') {
        const question = args.question || '需要你的确认';
        let options: string[] | undefined;
        if (args.options) {
          try { options = JSON.parse(args.options); }
          catch (e) { console.warn('[cyclone] ask options 解析失败', args.options, e); }
        }
        throw new SuspendSignal(question, options);
      }
      if (tool === 'register_tool') {
        try {
          const proposal = await prepareToolRegistration(dataDir, args);
          onToolRegistration(proposal);
          throw new SuspendSignal(
            `注册全局工具「${proposal.tool.name}」？\n${proposal.tool.description}\n执行生命周期：${proposal.tool.executionMode === 'detachable' ? '允许后台化' : '同步完成'}`,
            ['注册', '取消'],
          );
        } catch (error) {
          if (error instanceof SuspendSignal) throw error;
          const result = `工具注册失败：${(error as Error).message}`;
          onEvent({ type: 'tool-call', tool, args });
          onEvent({ type: 'tool-result', tool, result, ok: false });
          return { result, ok: false };
        }
      }
      if (tool === 'delegate') {
        return execDelegate(dataDir, agentId, sandboxLevel, args, signal, onEvent,
          { dataDir, feature: 'cyclone', target: { workshopId, kind: 'seat', targetId: seatId } });
      }
      if (tool === 'dispatch') {
        onEvent({ type: 'tool-call', tool, args });
        try {
          const item = await createSeatDispatchRecord(dataDir, {
            workshopId, sourceSeatId: seatId, sourceSeatTitle: seatTitle,
            sourceTurnId, dispatchOrder: dispatchOrder++,
            targetSeatTitle: args.target || '', task: args.task || '',
          });
          kickDispatchQueue(dataDir, workshopId, item.targetSeatId);
          const result = dispatchAcceptance(item.targetSeatTitle, item.id, 'seat');
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `异步派发失败：${(error as Error).message}`;
          onEvent({ type: 'tool-result', tool, result, ok: false });
          return { result, ok: false };
        }
      }
      // task_board 假工具：服务端 inline 落盘（工位目录），meta 走 UI 侧通道刷新任务板抽屉
      if (tool === 'task_board') {
        onEvent({ type: 'tool-call', tool, args });
        const { result, meta, ok } = await execTaskBoard(seatTaskboardFile(dataDir, workshopId, seatId), args);
        onEvent({ type: 'tool-result', tool, result, ok, meta });
        return { result, ok, meta };
      }
      // bulletin 假工具：工作室级公告板，工位可读取和新增（落款为本工位 title）
      if (tool === 'bulletin') {
        onEvent({ type: 'tool-call', tool, args });
        const { result, ok, meta } = await execBulletin(dataDir, workshopId, args, seatTitle);
        onEvent({ type: 'tool-result', tool, result, ok, meta });
        return { result, ok, meta };
      }
      if (tool === 'contact') {
        const contactId = `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const target = args.target || '';
        onEvent({ type: 'contact-start', target, message: args.message || '', contactId });
        const outcome = await execContactOutcome(
          { dataDir, workshopId, fromSeatId: seatId, fromTitle: seatTitle, depth: 0, signal },
          target, args.message || '',
        );
        onEvent({ type: 'contact-done', contactId, reply: outcome.result, ok: outcome.ok });
        return outcome;
      }
      if (isBackgroundExecutionTool(tool)) {
        onEvent({ type: 'tool-call', tool, args });
        const outcome = await executeBackgroundExecutionToolOutcome({
          tool,
          args,
          scope: 'cyclone',
          ownerId: `${workshopId}:${seatId}`,
        });
        onEvent({ type: 'tool-result', tool, ...outcome });
        return outcome;
      }
      onEvent({ type: 'tool-call', tool, args: rawArgs });
      try {
        const outcome = await execToolUnifiedOutcome({
          tool, args: rawArgs, agentId, workspaceDir: wsDir, sandboxLevel, signal,
          mediaAccess: { dataDir, feature: 'cyclone', target: { workshopId, kind: 'seat', targetId: seatId } },
          observation: { scope: 'cyclone', ownerId: `${workshopId}:${seatId}` },
          onObservationId: onExecution,
        });
        onEvent({ type: 'tool-result', tool, ...outcome });
        return outcome;
      } catch (e) {
        const err = `工具执行失败: ${(e as Error).message}`;
        onEvent({ type: 'tool-result', tool, result: err, ok: false });
        return { result: err, ok: false };
      }
    },
  };
}

// ── 核心驱动 ──────────────────────────────────────────────────────

interface DriveCtx {
  dataDir: string;
  workshopId: string;
  seat: SeatData;
  /** 本轮要跑的完整 messages（含 system + 历史 + 新消息/resume 回填） */
  messages: SeatContextMessage[];
  native: boolean;
  /** 已合并真实、虚拟与后台工具，须与文本提示词使用同一份清单。 */
  toolDefs: import('../shared/tool-defs-loader').ToolDef[];
  agent: import('../shared/agent-loader').LoadedAgent;
  signal?: AbortSignal;
  onEvent: (ev: SeatEvent) => void;
}

/**
 * 跑一轮 ReAct 并把结果持久化进 seat 文件。
 * native 优先走 runReActLoopNative；否则 runReActLoop 文本退路。
 * ask 挂起 → 存 pending；正常完成 → 存 assistant 回复 + 清 pending。
 */
async function driveSeat(ctx: DriveCtx): Promise<{
  content: string;
  rawContent: string;
  termination: ReActTermination;
  executionIds: string[];
}> {
  const {
    dataDir, workshopId, seat, messages, native, toolDefs, agent, signal, onEvent,
  } = ctx;
  const wsDir = wsRelPath(dataDir, workshopId);
  let generatedContextStart = messages.length;
  const llm = createSeatCompactionCaller({ dataDir, workshopId, seat, messages, agent,
    llm: makeLLM(dataDir, agent.model, agent.temperature), onNotice: onEvent, onProgress: onEvent,
    onCompacted: plan => {
      generatedContextStart = 2 + Math.max(0, generatedContextStart - 1 - plan.prefix.length);
    },
  });
  let pendingToolRegistration: ToolRegistrationProposal | undefined;
  const executionIds = new Set<string>();
  const toolCaller = makeToolCaller({
    dataDir, workshopId, seatId: seat.id, seatTitle: seat.title,
    agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir, signal, onEvent,
    onToolRegistration: proposal => { pendingToolRegistration = proposal; },
    onExecution: executionId => executionIds.add(executionId),
  });
  let reasoning = '';

  // toolCaller 恒提供：ask/delegate/contact/task_board/bulletin 是恒在的虚拟工具，
  // 即使工位没有任何真实工具也要能调用（否则文本模式下 bulletin/task_board 调不动）
  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: toolCaller, toolDefs,
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoning += ev.chunk;
          const progress = toSeatProgressEvent(ev);
          if (progress) onEvent(progress);
        },
        onToolError: (e) => e instanceof SuspendSignal ? { reason: 'ask', question: e.question, options: e.options } : null,
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: toolCaller,
        allowedTools: toolDefs.map(tool => tool.name),
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoning += ev.chunk;
          const progress = toSeatProgressEvent(ev);
          if (progress) onEvent(progress);
        },
        signal,
      });

  // 气旋历史存后端：补齐循环返回的最终回复，并把本轮原生思考作为展示元数据绑定。
  if (!result.suspended) {
    recordSeatAssistantResult(messages, result.content, reasoning, generatedContextStart);
  }

  // messages 被循环原地追加了 assistant/tool 消息；剔除开头注入的 system prompt 后即新历史。
  // 注意：仅剔除首条注入的 system，保留历史中的压缩摘要 system 消息
  // （/reset summary 落库的「重置前…摘要」气泡，否则下一轮对话后会被一并滤掉而消失）。
  seat.messages = messages.filter((m, i) => !(i === 0 && m.role === 'system'));
  // 变更注意力：标记本工位已读到当前公告板（含本轮自己的改动），下一轮据此算 🆕
  seat.bulletinSeenAt = readBulletinSync(dataDir, workshopId).updatedAt;
  if (result.suspended) {
    seat.pending = {
      question: result.suspended.question,
      options: result.suspended.options,
      pendingToolCallId: result.suspended.pendingToolCallId,
      native,
      toolRegistration: pendingToolRegistration,
    };
    await saveSeat(dataDir, workshopId, seat);
    onEvent({ type: 'ask', question: result.suspended.question, options: result.suspended.options });
    onEvent({ type: 'done' });
    return {
      content: '', rawContent: '', termination: result.termination,
      executionIds: [...executionIds],
    };
  }

  seat.pending = undefined;
  await saveSeat(dataDir, workshopId, seat);
  if (result.termination.status !== 'failed' && result.termination.status !== 'anomaly') {
    onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
    onEvent({ type: 'done' });
  }
  return {
    content: result.content, rawContent: result.rawContent, termination: result.termination,
    executionIds: [...executionIds],
  };
}

/** 加载工位 + 绑定 agent + 工具定义 + 决议 native + 可联络名单（chat/resume 共用前置） */
async function prepare(
  dataDir: string,
  workshopId: string,
  seatId: string,
  taskHint: string,
  signal?: AbortSignal,
) {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) throw new Error(`工位不存在：${seatId}`);
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) throw new Error(`工位绑定的 agent 不存在或已删除：${seat.agentId}`);
  const toolDefs = await withSupervisorReporting(dataDir, workshopId, withCycloneMemoryTools(
    await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode),
    { workshopId, seatId },
  ));
  const memorySection = await buildCycloneMemoryPrompt(dataDir, agent.id, taskHint, { workshopId, seatId });
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const [contactTargets, dispatchTargets] = await Promise.all([
    listOtherSeats(dataDir, workshopId, seatId),
    listWorkshopSeats(dataDir, workshopId, seatId, false),
  ]);
  return { seat, agent, toolDefs, native, contactTargets, dispatchTargets, memorySection };
}

/**
 * 处理一条发给工位的人类私聊消息。
 * 非阻塞锁：工位正忙则抛错（让上层返回 409），不排队。
 */
export async function chatSeat(
  dataDir: string, workshopId: string, seatId: string,
  humanMessage: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
): Promise<{
  content: string;
  rawContent: string;
  termination: ReActTermination;
  executionIds: string[];
}> {
  const release = tryAcquireSeatLock(workshopId, seatId);
  if (!release) throw new Error('工位正在执行中');
  try {
    return await chatSeatWithinExecution(
      dataDir, workshopId, seatId, humanMessage, onEvent, signal,
    );
  } finally {
    release();
  }
}

/** 已由上层执行目录持有工位锁时运行私聊。 */
export async function chatSeatWithinExecution(
  dataDir: string, workshopId: string, seatId: string,
  humanMessage: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
  inputIdentity?: CycloneInputIdentity,
): ReturnType<typeof chatSeat> {
  signal?.throwIfAborted();
  const queuedSeat = await loadSeat(dataDir, workshopId, seatId);
  if (!queuedSeat) throw new Error(`工位不存在：${seatId}`);
  return withAgentActivity(queuedSeat.agentId, 'cyclone', async () => {
        const { seat, agent, toolDefs, native, contactTargets, dispatchTargets, memorySection } = await prepare(
          dataDir, workshopId, seatId, humanMessage, signal,
        );
        if (seat.agentId !== queuedSeat.agentId) throw new Error(`工位「${queuedSeat.title}」已更换 Agent，本轮已跳过`);
        if (seat.pending) throw new Error('工位处于挂起状态，请先回复其提问（resume）');
        await deliverSeatDispatchReceipts(dataDir, workshopId, seat);
        const runtimeToolDefs = buildSeatToolCatalog(toolDefs, contactTargets, dispatchTargets, seatCollaborationPolicy(seat));
        const system: SeatContextMessage = {
          role: 'system', content: buildSeatSystemPrompt({
            dataDir, workshopId, seat, agent,
            toolDefs: runtimeToolDefs,
            native, contactTargets, memorySection,
            wsRelPath: wsRelPath(dataDir, workshopId), bulletinSeenAt: seat.bulletinSeenAt,
          }),
        };
        seat.messages.push({ role: 'user', content: humanMessage, ...inputIdentity });
        seat.compactionNotice = undefined;
        seat.compaction = undefined;
        await saveSeat(dataDir, workshopId, seat, signal);
        onEvent({ type: 'input-accepted' });
        const messages = [system, ...seat.messages];
        return driveSeat({
          dataDir, workshopId, seat, messages, native,
          toolDefs: runtimeToolDefs, agent, signal, onEvent,
        });
  });
}

/**
 * 恢复挂起的工位：人类回复了 ask 问题。
 * 原生模式把回复作为 role:'tool' 配对补上；文本模式追加 JSON 工具结果。
 */
export async function resumeSeat(
  dataDir: string, workshopId: string, seatId: string,
  answer: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
): Promise<{
  content: string;
  rawContent: string;
  termination: ReActTermination;
  executionIds: string[];
}> {
  const release = tryAcquireSeatLock(workshopId, seatId);
  if (!release) throw new Error('工位正在执行中');
  try {
    return await resumeSeatWithinExecution(
      dataDir, workshopId, seatId, answer, onEvent, signal,
    );
  } finally {
    release();
  }
}

/** 已由上层执行目录持有工位锁时恢复挂起私聊。 */
export async function resumeSeatWithinExecution(
  dataDir: string, workshopId: string, seatId: string,
  answer: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
): ReturnType<typeof resumeSeat> {
  const queuedSeat = await loadSeat(dataDir, workshopId, seatId);
  if (!queuedSeat) throw new Error(`工位不存在：${seatId}`);
  return withAgentActivity(queuedSeat.agentId, 'cyclone', async () => {
        const native = await applyPendingSeatResponse(
          dataDir, workshopId, queuedSeat, answer, onEvent,
        );
        const { seat, agent, toolDefs, contactTargets, dispatchTargets, memorySection } = await prepare(
          dataDir, workshopId, seatId, answer, signal,
        );
        if (seat.agentId !== queuedSeat.agentId) throw new Error(`工位「${queuedSeat.title}」已更换 Agent，本轮已跳过`);
        // 原生 tool result 已持久化；回执只能在回答落位后注入。
        await deliverSeatDispatchReceipts(dataDir, workshopId, seat);
        const runtimeToolDefs = buildSeatToolCatalog(toolDefs, contactTargets, dispatchTargets, seatCollaborationPolicy(seat));
        const system: SeatContextMessage = {
          role: 'system', content: buildSeatSystemPrompt({
            dataDir, workshopId, seat, agent,
            toolDefs: runtimeToolDefs,
            native, contactTargets, memorySection,
            wsRelPath: wsRelPath(dataDir, workshopId), bulletinSeenAt: seat.bulletinSeenAt,
          }),
        };
        seat.compactionNotice = undefined;
        seat.compaction = undefined;
        await saveSeat(dataDir, workshopId, seat);
        onEvent({ type: 'input-accepted' });
        const messages = [system, ...seat.messages];
        return driveSeat({
          dataDir, workshopId, seat, messages, native,
          toolDefs: runtimeToolDefs, agent, signal, onEvent,
        });
  });
}
