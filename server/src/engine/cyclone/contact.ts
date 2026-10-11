/**
 * 气旋 Contact 执行器 —— 工位间同步联络的投递层
 *
 * 拿目标工位锁 → 加载会话 → 追加联络消息 → 跑一轮 ReAct → 落盘 → 回传回复。
 * 目标回复写进目标工位会话。
 *
 * 防护：waitGraph 环检测 + 嵌套深度上限 + abort 处理；
 *   目标锁被占（人类正私聊 / 已被别的 contact 占用）→ 返回「正忙」，非阻塞。
 *
 * 依赖 shared/ 与本目录模块。
 */

import type { ContextMessage } from '../shared/types';
import { resolveNativeMode } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnifiedOutcome } from '../shared/exec-tool';
import { runReActLoopNative, type ToolCaller, type ToolCallOutcome, type LLMCaller, type ReActLoopResult } from '../shared/react/native-loop';
import { runReActLoop } from '../shared/react/text-loop';
import { callLLM } from '../shared/llm-bridge';
import { buildSeatContactSystemPrompt } from './seat-prompt';
import {
  buildCycloneMemoryPrompt,
  executeCycloneMemoryTool,
  isCycloneMemoryTool,
  withCycloneMemoryTools,
} from './cyclone-memory.js';
import { execBulletin } from './bulletin';
import { buildContactToolCatalog } from './seat-tool-catalog';
import { withNativeContactToolEvents } from './contact-tool-events.js';
import { loadSeat, saveSeat, tryAcquireSeatLock } from './seat-store';
import { listOtherSeats, tryRegisterWait, clearWait } from './contact-registry';
import { resolveAuthorizedTarget } from './organization/organization-authorization.js';
import { FrameworkError } from '../shared/framework-error.js';
import { workshopWorkspace } from './paths';
import type { SeatData } from './types';
import { beginExternalSeatActivity } from './seat-activity.js';
import { toSeatProgressEvent, type LoopProgressEvent } from './loop-event-forwarder.js';
import path from 'node:path';
import { createSeatCompactionCaller } from './conversation-compaction-caller.js';

/** 嵌套联络深度上限（A→B→C→…），超过即拒绝，防失控递归 */
const MAX_CONTACT_DEPTH = 5;

export interface ContactCtx {
  dataDir: string;
  workshopId: string;
  /** 发起方工位 id（环检测用） */
  fromSeatId: string;
  /** 发起方工位 title（注入目标的联络标头） */
  fromTitle: string;
  /** 当前嵌套深度（顶层=0） */
  depth: number;
  signal?: AbortSignal;
}

export async function persistContactMessage(
  dataDir: string, workshopId: string, seat: SeatData,
  fromTitle: string, message: string,
): Promise<void> {
  seat.messages.push({ role: 'user', content: `[系统信息：来自工位「${fromTitle}」的联络]\n\n${message}` });
  await saveSeat(dataDir, workshopId, seat);
}

function wsRel(dataDir: string, workshopId: string): string {
  const projectDir = path.resolve(dataDir, '..');
  return path.relative(projectDir, workshopWorkspace(dataDir, workshopId));
}

function makeLLM(dataDir: string, model: string, temperature: number): LLMCaller {
  return {
    async call(msgs, _opts, onChunk, sig, tools, onReasoning, onToolProgress) {
      return callLLM({
        dataDir, fullModelKey: model, messages: msgs, options: { temperature },
        onChunk, signal: sig, tools, onReasoning, onToolProgress,
      });
    },
  };
}

export function forwardContactEvent(
  event: LoopProgressEvent,
  emit: (event: Record<string, unknown>) => void,
): void {
  const progress = toSeatProgressEvent(event);
  if (progress) emit({ ...progress });
  if (event.type === 'tool-call') emit({ type: 'tool-call', tool: event.tool, args: event.args });
  if (event.type === 'tool-result') emit({ type: 'tool-result', tool: event.tool,
    result: event.result, ok: event.ok ?? true });
  if (event.type === 'error') emit({ type: 'error', message: event.message });
}

/**
 * 执行一次 contact：发起方 A 联络目标 title。
 * 返回值即作为 A 的 contact 工具调用结果（含系统标头）。
 */
export async function execContact(ctx: ContactCtx, target: string, message: string): Promise<string> {
  return (await execContactOutcome(ctx, target, message)).result;
}

export async function execContactOutcome(
  ctx: ContactCtx, target: string, message: string,
): Promise<ToolCallOutcome> {
  const { dataDir, workshopId, fromSeatId, depth } = ctx;

  if (depth >= MAX_CONTACT_DEPTH) {
    return { result: `联络失败：联络嵌套层级已达上限（${MAX_CONTACT_DEPTH}），请直接处理或简化协作链路。`, ok: false };
  }

  // 1. 寻址：title → seatId
  let targetSeatId: string;
  try {
    targetSeatId = (await resolveAuthorizedTarget(
      dataDir, workshopId, fromSeatId, target, 'contact',
    )).id;
  } catch (error) {
    if (error instanceof FrameworkError && ['not_found', 'permission'].includes(error.data.kind)) {
      return { result: `联络失败：${error.message}`, ok: false };
    }
    throw error;
  }

  // 2. waitGraph 环检测
  if (!tryRegisterWait(workshopId, fromSeatId, targetSeatId)) {
    return { result: `联络被系统拒绝：「${target}」当前正在等待你的回复，反向联络会造成死锁。请直接在当前回复中处理。`, ok: false };
  }

  // 3. 拿目标锁（非阻塞）。被占即返回「正忙」，不排队
  const release = tryAcquireSeatLock(workshopId, targetSeatId);
  if (!release) {
    clearWait(workshopId, fromSeatId);
    return { result: `联络失败：「${target}」当前正忙（正在被其他会话占用），请稍后再试或改由人类协调。`, ok: false };
  }

  return completeContact(ctx, target, message, targetSeatId, release);
}

async function completeContact(
  ctx: ContactCtx, target: string, message: string,
  targetSeatId: string, release: () => void,
): Promise<ToolCallOutcome> {
  const { workshopId, fromSeatId, fromTitle } = ctx;
  const activity = beginExternalSeatActivity(
    workshopId, targetSeatId, 'contact', `正在处理来自「${fromTitle}」的联络`,
    fromSeatId,
  );
  try {
    const answer = await runContactedTurn(ctx, targetSeatId, message, activity.emit);
    return answer.ok
      ? { result: `[系统信息：来自工位「${target}」的回复]\n\n${answer.result}`, ok: true }
      : { result: `联络「${target}」失败：${answer.result}`, ok: false };
  } catch (e) {
    activity.emit({ type: 'error', message: (e as Error).message });
    return { result: `联络「${target}」失败：${(e as Error).message}`, ok: false };
  } finally {
    activity.finish();
    release();
    clearWait(workshopId, fromSeatId);
  }
}

function contactTurnOutcome(result: ReActLoopResult): ToolCallOutcome {
  const { termination } = result;
  if (termination.status === 'succeeded') {
    return { result: result.content || '（对方未给出有效回复）', ok: true };
  }
  const reason = termination.status === 'aborted' ? '已中止'
    : termination.status === 'waiting' ? '目标工位等待人类输入'
      : termination.error.message;
  return { result: reason, ok: false };
}

/**
 * 目标工位被联络后的一轮处理：加载会话 → 追加联络消息 → 跑一轮 → 落盘 → 返回干净回复。
 * 目标在本轮可继续 contact（嵌套深度 +1），其工具调用器内含 contact 分支。
 */
async function runContactedTurn(
  ctx: ContactCtx,
  targetSeatId: string,
  message: string,
  emit: (event: Record<string, unknown>) => void,
): Promise<ToolCallOutcome> {
  const { dataDir, workshopId, fromTitle, depth, signal } = ctx;

  const seat = await loadSeat(dataDir, workshopId, targetSeatId);
  if (!seat) throw new Error('目标工位会话不存在');
  if (seat.pending) throw new Error(`「${seat.title}」正挂起等待人类回复，暂时无法处理联络`);

  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) throw new Error(`「${seat.title}」绑定的 agent 已删除`);

  const toolDefs = withCycloneMemoryTools(
    await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode),
  );
  const memorySection = await buildCycloneMemoryPrompt(dataDir, agent.id, message);
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const wsDir = wsRel(dataDir, workshopId);

  // 目标可联络的其他工位（去自身），用于嵌套 contact 热注入
  const contactTargets = await listOtherSeats(dataDir, workshopId, targetSeatId);

  const toolCaller: ToolCaller = {
    async call(tool, args) {
      if (isCycloneMemoryTool(tool)) {
        try {
          return (await executeCycloneMemoryTool(dataDir, agent.id, tool, args))!;
        } catch (error) {
          return { result: `记忆工具执行失败: ${(error as Error).message}`, ok: false };
        }
      }
      if (tool === 'bulletin') {
        return execBulletin(dataDir, workshopId, args, seat.title);
      }
      if (tool === 'contact') {
        // 嵌套联络：发起方变成当前目标工位，深度 +1
        return execContactOutcome(
          { dataDir, workshopId, fromSeatId: targetSeatId, fromTitle: seat.title, depth: depth + 1, signal },
          args.target || '', args.message || '',
        );
      }
      if (tool === 'delegate') {
        const { runSubAgent } = await import('../shared/sub-agent-runner');
        const abortCtrl = new AbortController();
        signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true });
        const r = await runSubAgent({
          task: args.task || '', context: args.context || '', systemPrompt: args.systemPrompt || '',
          agentId: agent.id, dataDir, signal: abortCtrl.signal, timeout: 1_200_000, maxRounds: 100,
          parentSandboxLevel: agent.sandboxLevel,
        });
        return { result: `[${r.status}] ${r.summary}`, ok: r.status === 'success' };
      }
      try {
        return await execToolUnifiedOutcome({ tool, args, agentId: agent.id, workspaceDir: wsDir, sandboxLevel: agent.sandboxLevel, signal });
      } catch (e) {
        return { result: `工具执行失败: ${(e as Error).message}`, ok: false };
      }
    },
  };

  // 联络消息进目标会话（收件箱语义）
  // 先落盘入站气泡，再启动模型；目标工位页面可在处理期间看到消息。
  await persistContactMessage(dataDir, workshopId, seat, fromTitle, message);

  const runtimeToolDefs = buildContactToolCatalog(toolDefs, contactTargets);
  const system: ContextMessage = {
    role: 'system',
    content: buildSeatContactSystemPrompt({
      dataDir, workshopId, seat, agent,
      toolDefs: native ? toolDefs : runtimeToolDefs,
      native, wsRelPath: wsDir, fromTitle, memorySection,
    }),
  };
  const messages = [system, ...seat.messages];
  const llm = createSeatCompactionCaller({ dataDir, workshopId, seat, messages, agent,
    llm: makeLLM(dataDir, agent.model, agent.temperature), onNotice: notice => emit({ ...notice }) });
  // 被联络方剥 ask（无人类在场），保留 delegate + 嵌套 contact

  const onEvent = (event: LoopProgressEvent) => forwardContactEvent(event, emit);
  const reportingToolCaller = native ? withNativeContactToolEvents(toolCaller, emit) : toolCaller;
  const result = native
    ? await runReActLoopNative({ messages, llm, tools: reportingToolCaller, toolDefs: runtimeToolDefs, onEvent, signal })
    : await runReActLoop({
        messages,
        llm,
        tools: reportingToolCaller,
        allowedTools: runtimeToolDefs.map(tool => tool.name),
        onEvent,
        signal,
      });

  // 落盘目标会话（剔除 system）
  // react-loop 最终回答只 return、不 push，气旋后端持久化需在此补 push（同 driveSeat）
  if (result.content && !result.content.startsWith('[中止]') && !result.content.startsWith('[错误]')) {
    const last = messages[messages.length - 1];
    if (!(last?.role === 'assistant' && last.content === result.content)) {
      messages.push({ role: 'assistant', content: result.content });
    }
  }
  // 仅剔除首条注入的 system prompt，保留历史中的压缩摘要 system 消息（同 driveSeat）
  seat.messages = messages.filter((m, i) => !(i === 0 && m.role === 'system'));
  await saveSeat(dataDir, workshopId, seat);

  emit({ type: 'answer', content: result.content, rawContent: result.rawContent });

  return contactTurnOutcome(result);
}
