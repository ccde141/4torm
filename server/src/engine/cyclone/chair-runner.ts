/**
 * 气旋会长执行器 —— 独立私聊通道，俯瞰工作室全景
 *
 * 结构照搬 seat-runner，差异：
 * - 不读工位/不调 contact-registry/不生成 duty 段
 * - System prompt 走 buildChairPrompt（群聊总览 + 工位名册）
 * - 虚拟工具只给 ask + delegate，不注入 contact
 * - 会话落 chair.json 而非 seat 文件
 */

import type { ContextMessage } from '../shared/types';
import { callLLM, resolveNativeMode, type TokenUsage } from '../shared/llm-bridge';
import { loadAgent, type LoadedAgent } from '../shared/agent-loader';
import { loadAgentToolDefs, type ToolDef } from '../shared/tool-defs-loader';
import { execToolUnified } from '../shared/exec-tool';
import {
  runReActLoop,
  runReActLoopNative,
  SuspendSignal,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { buildChairPrompt } from './seat-prompt';
import { wsRelPath, type SeatEvent } from './seat-runner';
import { loadChair, saveChair, tryAcquireChairLock, type ChairSession } from './chair-store';
import { loadWorkshop } from './workshop-store';

function makeLLM(dataDir: string, model: string, temperature: number): LLMCaller {
  return {
    async call(msgs, _opts, onChunk, sig, tools) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
    },
  };
}

async function execChairDelegate(
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
      else if (ev.type === 'tool_call') onEvent({ type: 'delegate-tool-call', delegateId, tool: ev.data.tool, args: ev.data.args });
      else if (ev.type === 'tool_result') onEvent({ type: 'delegate-tool-result', delegateId, tool: ev.data.tool, result: ev.data.result, ok: ev.data.ok });
    },
  });
  onEvent({ type: 'delegate-done', delegateId, summary: result.summary, status: result.status });
  return `[${result.status}] ${result.summary}`;
}

function makeChairToolCaller(opts: {
  dataDir: string; workshopId: string; agentId: string; sandboxLevel: string; wsDir: string;
  signal: AbortSignal | undefined; onEvent: (ev: SeatEvent) => void;
}): ToolCaller {
  const { dataDir, agentId, sandboxLevel, wsDir, signal, onEvent } = opts;
  return {
    async call(tool, args) {
      if (tool === 'ask') {
        const question = args.question || '需要你的确认';
        let options: string[] | undefined;
        if (args.options) { try { options = JSON.parse(args.options); } catch {} }
        throw new SuspendSignal(question, options);
      }
      if (tool === 'delegate') {
        return execChairDelegate(dataDir, agentId, sandboxLevel, args, signal, onEvent);
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

interface DriveCtx {
  dataDir: string;
  workshopId: string;
  chair: ChairSession;
  messages: ContextMessage[];
  native: boolean;
  toolDefs: ToolDef[];
  agent: LoadedAgent;
  signal?: AbortSignal;
  onEvent: (ev: SeatEvent) => void;
}

async function driveChair(ctx: DriveCtx): Promise<{ content: string; rawContent: string }> {
  const { dataDir, workshopId, chair, messages, native, toolDefs, agent, signal, onEvent } = ctx;
  const wsDir = wsRelPath(dataDir, workshopId);
  const llm = makeLLM(dataDir, agent.model, agent.temperature);
  const toolCaller = makeChairToolCaller({
    dataDir, workshopId, agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir, signal, onEvent,
  });
  const nativeToolDefs = [...toolDefs, ...buildSeatVirtualToolDefs({ allowAsk: true, allowDelegate: true })];

  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: toolCaller, toolDefs: nativeToolDefs,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk }); },
        onToolError: (e) => e instanceof SuspendSignal ? { reason: 'ask', question: e.question, options: e.options } : null,
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: toolCaller,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk }); },
        signal,
      });

  if (!result.suspended && result.content
      && !result.content.startsWith('[中止]') && !result.content.startsWith('[错误]')) {
    const last = messages[messages.length - 1];
    if (!(last?.role === 'assistant' && last.content === result.content)) {
      messages.push({ role: 'assistant', content: result.content });
    }
  }

  chair.messages = messages.filter(m => m.role !== 'system');
  if (result.usage) {
    chair.tokenUsage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
    onEvent({ type: 'usage', usage: result.usage });
  }

  if (result.suspended) {
    chair.pending = {
      question: result.suspended.question,
      options: result.suspended.options,
      pendingToolCallId: result.suspended.pendingToolCallId,
      native,
    };
    await saveChair(dataDir, workshopId, chair);
    onEvent({ type: 'ask', question: result.suspended.question, options: result.suspended.options });
    onEvent({ type: 'done' });
    return { content: '', rawContent: '' };
  }

  chair.pending = undefined;
  await saveChair(dataDir, workshopId, chair);
  onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
  onEvent({ type: 'done' });
  return { content: result.content, rawContent: result.rawContent };
}

async function prepareChair(dataDir: string, workshopId: string) {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) throw new Error('工作室不存在');
  if (!w.chairAgentId) throw new Error('该工作室未指定会长');
  const chair = await loadChair(dataDir, workshopId) || { messages: [] as ContextMessage[] };
  const agent = await loadAgent(dataDir, w.chairAgentId);
  if (!agent) throw new Error(`会长绑定的 agent 不存在或已删除：${w.chairAgentId}`);
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  return { w, chair, agent, toolDefs, native };
}

export async function chatChair(
  dataDir: string,
  workshopId: string,
  humanMessage: string,
  onEvent: (ev: SeatEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }> {
  const release = tryAcquireChairLock(workshopId);
  if (!release) throw new Error('会长正在执行中');
  try {
    const { w, chair, agent, toolDefs, native } = await prepareChair(dataDir, workshopId);
    if (chair.pending) throw new Error('会长处于挂起状态，请先回复其提问（resume）');
    const { systemMessage, native: resolvedNative } = await buildChairPrompt(dataDir, workshopId, w, agent, native);
    chair.messages.push({ role: 'user', content: humanMessage });
    const messages: ContextMessage[] = [systemMessage, ...chair.messages];
    return await driveChair({ dataDir, workshopId, chair, messages, native: resolvedNative, toolDefs, agent, signal, onEvent });
  } finally {
    release();
  }
}

export async function resumeChair(
  dataDir: string,
  workshopId: string,
  answer: string,
  onEvent: (ev: SeatEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }> {
  const release = tryAcquireChairLock(workshopId);
  if (!release) throw new Error('会长正在执行中');
  try {
    const { w, chair, agent, toolDefs } = await prepareChair(dataDir, workshopId);
    if (!chair.pending) throw new Error('会长未处于挂起状态');
    const pending = chair.pending;
    if (pending.pendingToolCallId) {
      chair.messages.push({ role: 'tool', toolCallId: pending.pendingToolCallId, content: answer });
    } else {
      chair.messages.push({ role: 'user', content: `<result tool="ask">${answer}</result>` });
    }
    const { systemMessage, native: resolvedNative } = await buildChairPrompt(dataDir, workshopId, w, agent, pending.native);
    const messages: ContextMessage[] = [systemMessage, ...chair.messages];
    return await driveChair({ dataDir, workshopId, chair, messages, native: resolvedNative, toolDefs, agent, signal, onEvent });
  } finally {
    release();
  }
}
