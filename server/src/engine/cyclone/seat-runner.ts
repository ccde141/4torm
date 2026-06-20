/**
 * 气旋工位执行器 —— 无常驻实例，状态全落 SeatData 文件
 *
 * 边界铁律：只 import shared/ 与本目录模块。react-loop 是季风忠实副本（cyclone 自有）。
 *
 * 与季风 SessionRunner 的本质差异（文档 §2 复用陷阱）：
 * - 季风 runner 是内存常驻实例，挂起态存内存；
 * - 气旋无常驻 runner，每次调用 load→run→save，挂起态写进 seat 文件的 pending 字段。
 *
 * 一次 chat：load seat+agent → 组 prompt → 跑 ReAct（native 优先 / text 退路）
 *            → ask 挂起则存 pending；否则存最终回复 → 持久化。
 */

import type { ContextMessage } from '../shared/types';
import { callLLM, resolveNativeMode, type TokenUsage } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnified } from '../shared/exec-tool';
import {
  runReActLoop,
  runReActLoopNative,
  SuspendSignal,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { buildSeatSystemPrompt } from './seat-prompt';
import { workshopWorkspace } from './paths';
import { loadSeat, saveSeat, tryAcquireSeatLock } from './seat-store';
import { execContact } from './contact';
import { listOtherSeatTitles } from './contact-registry';
import type { SeatData } from './types';
import path from 'node:path';

/** 工位执行事件（流式推送用） */
export type SeatEvent =
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'usage'; usage: TokenUsage }
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
    async call(msgs, _opts, onChunk, sig, tools) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
    },
  };
}

/** 执行 delegate（落到 shared/sub-agent-runner） */
async function execDelegate(
  dataDir: string, agentId: string, sandboxLevel: string,
  args: Record<string, string>, signal: AbortSignal | undefined, onEvent: (ev: SeatEvent) => void,
): Promise<string> {
  const { runSubAgent } = await import('../shared/sub-agent-runner');
  const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  onEvent({ type: 'delegate-start', task: args.task || '', delegateId });
  const abortCtrl = new AbortController();
  signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true });
  const result = await runSubAgent({
    task: args.task || '',
    context: args.context || '',
    systemPrompt: args.systemPrompt || '',
    agentId,
    dataDir,
    signal: abortCtrl.signal,
    timeout: 1_200_000,
    maxRounds: 100,
    parentSandboxLevel: sandboxLevel as 'strict' | 'relaxed' | 'unrestricted',
    emit: (ev) => {
      if (ev.type === 'token') onEvent({ type: 'delegate-token', delegateId, content: ev.data.t });
    },
  });
  onEvent({ type: 'delegate-done', delegateId, summary: result.summary, status: result.status });
  return `[${result.status}] ${result.summary}`;
}

/** 构造工位工具调用器：ask 抛挂起信号，delegate 派子，contact 联络其他工位，其余走 shared/execToolUnified */
function makeToolCaller(opts: {
  dataDir: string; workshopId: string; seatId: string; seatTitle: string;
  agentId: string; sandboxLevel: string; wsDir: string;
  signal: AbortSignal | undefined; onEvent: (ev: SeatEvent) => void;
}): ToolCaller {
  const { dataDir, workshopId, seatId, seatTitle, agentId, sandboxLevel, wsDir, signal, onEvent } = opts;
  return {
    async call(tool, args) {
      if (tool === 'ask') {
        const question = args.question || '需要你的确认';
        let options: string[] | undefined;
        if (args.options) { try { options = JSON.parse(args.options); } catch {} }
        throw new SuspendSignal(question, options);
      }
      if (tool === 'delegate') {
        return execDelegate(dataDir, agentId, sandboxLevel, args, signal, onEvent);
      }
      if (tool === 'contact') {
        onEvent({ type: 'tool-call', tool, args });
        const result = await execContact(
          { dataDir, workshopId, fromSeatId: seatId, fromTitle: seatTitle, depth: 0, signal },
          args.target || '', args.message || '',
        );
        const ok = !result.startsWith('联络失败') && !result.startsWith('联络被系统拒绝') && !result.includes('正忙');
        onEvent({ type: 'tool-result', tool, result, ok });
        return result;
      }
      onEvent({ type: 'tool-call', tool, args });
      try {
        const result = await execToolUnified({ tool, args, agentId, workspaceDir: wsDir, sandboxLevel, signal });
        onEvent({ type: 'tool-result', tool, result, ok: true });
        return result;
      } catch (e) {
        const err = `工具执行失败: ${(e as Error).message}`;
        onEvent({ type: 'tool-result', tool, result: err, ok: false });
        return err;
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
  messages: ContextMessage[];
  native: boolean;
  toolDefs: import('../shared/tool-defs-loader').ToolDef[];
  agent: import('../shared/agent-loader').LoadedAgent;
  /** 可联络的其他工位 title（热注入 contact 名单） */
  contactTargets: string[];
  signal?: AbortSignal;
  onEvent: (ev: SeatEvent) => void;
}

/**
 * 跑一轮 ReAct 并把结果持久化进 seat 文件。
 * native 优先走 runReActLoopNative；否则 runReActLoop 文本退路。
 * ask 挂起 → 存 pending；正常完成 → 存 assistant 回复 + 清 pending。
 */
async function driveSeat(ctx: DriveCtx): Promise<{ content: string; rawContent: string }> {
  const { dataDir, workshopId, seat, messages, native, toolDefs, agent, contactTargets, signal, onEvent } = ctx;
  const wsDir = wsRelPath(dataDir, workshopId);
  const llm = makeLLM(dataDir, agent.model, agent.temperature);
  const toolCaller = makeToolCaller({
    dataDir, workshopId, seatId: seat.id, seatTitle: seat.title,
    agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir, signal, onEvent,
  });
  const enableTools = toolDefs.length > 0;
  const nativeToolDefs = [...toolDefs, ...buildSeatVirtualToolDefs({ allowAsk: true, allowDelegate: true, contactTargets })];

  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: toolCaller, toolDefs: nativeToolDefs,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk }); },
        onToolError: (e) => e instanceof SuspendSignal ? { reason: 'ask', question: e.question, options: e.options } : null,
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: enableTools ? toolCaller : undefined,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk }); },
        signal,
      });

  // react-loop 给出最终回答时只 return content、不 push 进 messages（季风行为：历史存前端）。
  // 气旋历史存后端，故在此补 push，否则 reload 后最终回复丢失（复用陷阱 §2）。
  if (!result.suspended && result.content
      && !result.content.startsWith('[中止]') && !result.content.startsWith('[错误]')) {
    const last = messages[messages.length - 1];
    if (!(last?.role === 'assistant' && last.content === result.content)) {
      messages.push({ role: 'assistant', content: result.content });
    }
  }

  // messages 被循环原地追加了 assistant/tool 消息；剔除开头 system 后即新历史
  seat.messages = messages.filter(m => m.role !== 'system');
  if (result.usage) {
    seat.tokenUsage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
    onEvent({ type: 'usage', usage: result.usage });
  }

  if (result.suspended) {
    seat.pending = {
      question: result.suspended.question,
      options: result.suspended.options,
      pendingToolCallId: result.suspended.pendingToolCallId,
      native,
    };
    await saveSeat(dataDir, workshopId, seat);
    onEvent({ type: 'ask', question: result.suspended.question, options: result.suspended.options });
    onEvent({ type: 'done' });
    return { content: '', rawContent: '' };
  }

  seat.pending = undefined;
  await saveSeat(dataDir, workshopId, seat);
  onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
  onEvent({ type: 'done' });
  return { content: result.content, rawContent: result.rawContent };
}

/** 加载工位 + 绑定 agent + 工具定义 + 决议 native + 可联络名单（chat/resume 共用前置） */
async function prepare(dataDir: string, workshopId: string, seatId: string) {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) throw new Error(`工位不存在：${seatId}`);
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) throw new Error(`工位绑定的 agent 不存在或已删除：${seat.agentId}`);
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const contactTargets = await listOtherSeatTitles(dataDir, workshopId, seatId);
  return { seat, agent, toolDefs, native, contactTargets };
}

/**
 * 处理一条发给工位的人类私聊消息。
 * 非阻塞锁：工位正忙则抛错（让上层返回 409），不排队。
 */
export async function chatSeat(
  dataDir: string, workshopId: string, seatId: string,
  humanMessage: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }> {
  const release = tryAcquireSeatLock(workshopId, seatId);
  if (!release) throw new Error('工位正在执行中');
  try {
    const { seat, agent, toolDefs, native, contactTargets } = await prepare(dataDir, workshopId, seatId);
    if (seat.pending) throw new Error('工位处于挂起状态，请先回复其提问（resume）');
    const system: ContextMessage = {
      role: 'system',
      content: buildSeatSystemPrompt({ dataDir, seat, agent, toolDefs, native, wsRelPath: wsRelPath(dataDir, workshopId) }),
    };
    seat.messages.push({ role: 'user', content: humanMessage });
    const messages: ContextMessage[] = [system, ...seat.messages];
    return await driveSeat({ dataDir, workshopId, seat, messages, native, toolDefs, agent, contactTargets, signal, onEvent });
  } finally {
    release();
  }
}

/**
 * 恢复挂起的工位：人类回复了 ask 问题。
 * 原生模式把回复作为 role:'tool' 配对补上；文本模式作为 <result tool="ask"> 追加。
 */
export async function resumeSeat(
  dataDir: string, workshopId: string, seatId: string,
  answer: string, onEvent: (ev: SeatEvent) => void, signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }> {
  const release = tryAcquireSeatLock(workshopId, seatId);
  if (!release) throw new Error('工位正在执行中');
  try {
    const { seat, agent, toolDefs, native: _n, contactTargets } = await prepare(dataDir, workshopId, seatId);
    if (!seat.pending) throw new Error('工位未处于挂起状态');
    const pending = seat.pending;
    if (pending.pendingToolCallId) {
      seat.messages.push({ role: 'tool', toolCallId: pending.pendingToolCallId, content: answer });
    } else {
      seat.messages.push({ role: 'user', content: `<result tool="ask">${answer}</result>` });
    }
    // resume 用挂起时的 native 模式，保证 prompt 协议段与循环模式一致
    const system: ContextMessage = {
      role: 'system',
      content: buildSeatSystemPrompt({ dataDir, seat, agent, toolDefs, native: pending.native, wsRelPath: wsRelPath(dataDir, workshopId) }),
    };
    const messages: ContextMessage[] = [system, ...seat.messages];
    return await driveSeat({ dataDir, workshopId, seat, messages, native: pending.native, toolDefs, agent, contactTargets, signal, onEvent });
  } finally {
    release();
  }
}
