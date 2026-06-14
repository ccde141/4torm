/**
 * 对流会话业务逻辑处理器（重构版）
 *
 * 从持久化 session 加载 Agent 环境，使用对流自己的 ReAct 循环。
 *
 * 职责：
 * - handleSpeak：人类发言 → 参与 Agent 串行响应
 * - handleChair：人类给会长发消息 → 会长响应
 */

import type { ContextMessage } from '../shared/types';
import type { ConvectionSessionData } from './session';
import { saveSession, sessionWorkspace } from './session';
import { callLLM, resolveNativeMode, type TokenUsage } from '../shared/llm-bridge';
import { loadAgent, type LoadedAgent } from '../shared/agent-loader';
import { loadAgentToolDefs, type ToolDef } from '../shared/tool-defs-loader';
import { buildSystemPrompt } from '../shared/prompt';
import { buildSandboxSection } from '../shared/sandbox-prompt';
import { compactConvectionIfNeeded, type ConvectionCompactState } from './convection-compactor';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  runConvectionReAct,
  type ToolCallRecord,
  type ConvectionReActEvent,
} from './react-loop';
import { buildNativeConvectionProtocol, runConvectionReActNative } from './native-adapter';

const LLM_TIMEOUT_MS = 3_600_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

/** 覆盖 session 的 tokenUsage（取最新一次 LLM 调用值，代表当前上下文体积） */
function updateSessionUsage(session: ConvectionSessionData, u: TokenUsage | undefined): void {
  if (!u) return;
  session.tokenUsage = {
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    totalTokens: u.promptTokens + u.completionTokens,
  };
}

/** Agent 实体缓存 */
const agentCache = new Map<string, LoadedAgent>();

async function getAgent(dataDir: string, agentId: string): Promise<LoadedAgent> {
  const cached = agentCache.get(agentId);
  if (cached) return cached;
  const loaded = await loadAgent(dataDir, agentId);
  if (!loaded) throw new Error(`Agent 实体不存在：${agentId}`);
  agentCache.set(agentId, loaded);
  return loaded;
}

/** SSE 事件类型 */
export type ConvectionStreamEvent =
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; label: string; tool: string; result: string }
  | { type: 'agent-done'; label: string; content: string; rawContent: string; toolCalls: ToolCallRecord[] }
  | { type: 'heartbeat'; label: string; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedCycles: number; summaryLength: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

export { ToolCallRecord };

/**
 * 构造参与 Agent 在对流中的 system prompt + 历史消息。
 * 组装顺序：元认知 → 空间+权限 → 角色 → 基线 → 协议 → 场景上下文
 */
async function buildAgentMessages(
  dataDir: string,
  session: ConvectionSessionData,
  agentId: string,
  native?: boolean,
): Promise<{ messages: ContextMessage[]; agent: LoadedAgent; toolDefs: ToolDef[] }> {
  const agent = await getAgent(dataDir, agentId);
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  const wsPath = sessionWorkspace(dataDir, session.id);
  const projectDir = path.resolve(dataDir, '..');

  // 读对流自己的 meta.md / baseline.md
  const selfDir = path.dirname(fileURLToPath(import.meta.url));

  const parts: string[] = [];

  // 1. 元认知
  try {
    const meta = await fs.readFile(path.join(selfDir, 'meta.md'), 'utf-8');
    if (meta.trim()) parts.push(meta.trim());
  } catch { /* 文件不存在时跳过 */ }

  // 2. 空间 + 权限
  parts.push(buildSandboxSection({
    workspaceAbs: wsPath,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '对流会话工作区',
  }));

  // 3. 角色定义
  if (agent.rolePrompt) parts.push(agent.rolePrompt.trim());

  // 4. 基线固件
  try {
    const baseline = await fs.readFile(path.join(selfDir, 'baseline.md'), 'utf-8');
    if (baseline.trim()) parts.push(baseline.trim());
  } catch { /* 文件不存在时跳过 */ }

  // 5. 协议段
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeConvectionProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  // 6. 场景上下文
  parts.push(`## 当前场景\n你正以「${agent.name}」的身份参加一场多人对话。\n话题：${session.topic}\n请基于对话上下文回应人类的发言。简洁、有观点、有建设性。\n工具调用过程不会展示给其他参与者，只有最终回答会被公开。\n注意：历史消息中的 \`[名字]\` 前缀是系统自动添加的标记，你不需要在自己的回复中加上你的名字或任何类似前缀。`);

  const system: ContextMessage = { role: 'system', content: parts.join('\n\n') };
  const history: ContextMessage = { role: 'user', content: formatPublicContext(session) };
  return { messages: [system, history], agent, toolDefs };
}

function formatPublicContext(session: ConvectionSessionData): string {
  if (session.publicMessages.length === 0) return '（暂无发言）';
  return '以下是对话记录：\n\n' + session.publicMessages
    .map(m => `[${m.speaker}] ${m.content}`)
    .join('\n\n');
}

/**
 * 人类发言 → 参与 Agent 串行响应（流式）。
 */
export async function handleSpeak(
  dataDir: string,
  session: ConvectionSessionData,
  humanMessage: string,
  onEvent?: (ev: ConvectionStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  session.publicMessages.push({ speaker: '人类', content: humanMessage, timestamp: Date.now() });

  for (const agentId of session.participantAgentIds) {
    if (signal?.aborted) break;

    const agent = await getAgent(dataDir, agentId);
    onEvent?.({ type: 'agent-start', label: agent.name });

    // 每个 agent 各自决议原生模式（model 可能不同）
    const nativeDecision = await resolveNativeMode(dataDir, agent.model);
    console.log(`[convection] ${agent.name} (${agent.model}) → native=${nativeDecision.native} mode=${nativeDecision.mode}`);
    if (nativeDecision.forcedMismatch) {
      onEvent?.({ type: 'notice', message: `⚠️ ${agent.name} 的模型配置为强制原生工具调用，但探测显示可能不支持。如遇异常请调整模式。` });
    }

    let result: { cleanContent: string; rawContent: string; toolCalls: ToolCallRecord[]; usage?: TokenUsage };

    if (nativeDecision.native) {
      // 原生模式：adapter 注入共享 runReActLoopNative
      const { messages, agent: loadedAgent, toolDefs } = await buildAgentMessages(dataDir, session, agentId, true);
      result = await runConvectionReActNative({
        dataDir,
        model: loadedAgent.model,
        temperature: loadedAgent.temperature,
        agentId,
        sessionId: session.id,
        label: loadedAgent.name,
        messages,
        toolDefs,
        onEvent: onEvent ? (ev) => {
          if (ev.type === 'token') onEvent({ type: 'token', label: ev.label, chunk: ev.chunk! });
          else if (ev.type === 'tool-call') onEvent({ type: 'tool-call', label: ev.label, tool: ev.tool!, args: ev.args! });
          else if (ev.type === 'tool-result') onEvent({ type: 'tool-result', label: ev.label, tool: ev.tool!, result: ev.result! });
          else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', label: ev.label, phase: ev.phase!, elapsed: ev.elapsed! });
          else if (ev.type === 'error') onEvent({ type: 'error', message: ev.message! });
        } : undefined,
        signal,
      });
    } else {
      // 文本协议模式：现有 runConvectionReAct
      const { messages, agent: loadedAgent } = await buildAgentMessages(dataDir, session, agentId, false);
      const textResult = await runConvectionReAct({
        dataDir,
        model: loadedAgent.model,
        temperature: loadedAgent.temperature,
        agentId,
        sessionId: session.id,
        label: loadedAgent.name,
        messages,
        onEvent: onEvent ? (ev) => {
          if (ev.type === 'token') onEvent({ type: 'token', label: ev.label, chunk: ev.chunk! });
          else if (ev.type === 'tool-call') onEvent({ type: 'tool-call', label: ev.label, tool: ev.tool!, args: ev.args! });
          else if (ev.type === 'tool-result') onEvent({ type: 'tool-result', label: ev.label, tool: ev.tool!, result: ev.result! });
          else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', label: ev.label, phase: ev.phase!, elapsed: ev.elapsed! });
          else if (ev.type === 'error') onEvent({ type: 'error', message: ev.message! });
        } : undefined,
        signal,
      });
      result = textResult;
    }

    // abort 时保留已流式产出的有效内容
    const aborted = signal?.aborted;
    const content = result.cleanContent;
    if (content && !content.startsWith('[中止]') && !content.startsWith('[错误]')) {
      session.publicMessages.push({
        speaker: agent.name,
        content,
        timestamp: Date.now(),
        rawContent: result.rawContent || undefined,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      });
      updateSessionUsage(session, result.usage);
      onEvent?.({
        type: 'agent-done', label: agent.name,
        content, rawContent: result.rawContent, toolCalls: result.toolCalls,
      });
    }

    if (aborted) break;
  }

  // ── 压缩检测：会长负责整理 ──
  const promptTokens = session.tokenUsage?.promptTokens;
  if (promptTokens) {
    const state: ConvectionCompactState = session.compactState ?? { disabled: false, archiveSeq: 0 };
    const chairAgent = await getAgent(dataDir, session.chairAgentId);
    const wsPath = sessionWorkspace(dataDir, session.id);
    const archiveDir = path.join(wsPath, 'bak');

    // 收集参与者名称
    const participantNames: string[] = [];
    for (const pid of session.participantAgentIds) {
      const a = await getAgent(dataDir, pid);
      participantNames.push(a.name);
    }

    const compacted = await compactConvectionIfNeeded(
      session.publicMessages,
      promptTokens,
      state,
      {
        dataDir,
        chairModel: chairAgent.model,
        archiveDir,
        participants: participantNames,
        onEvent: (ev) => {
          if (ev.type === 'compact-start') onEvent?.({ type: 'compact-start' });
          if (ev.type === 'compact-done') onEvent?.({ type: 'compact-done', archivedCycles: ev.archivedCycles, summaryLength: ev.summaryLength });
          if (ev.type === 'compact-warn') onEvent?.({ type: 'error', message: ev.message });
        },
      },
    );

    session.compactState = state;
    if (compacted) {
      // 压缩后重新计算 token（下轮 LLM 调用会自然更新，这里先留旧值）
    }
  }

  await saveSession(dataDir, session);
}

/**
 * 人类给会长发消息 → 会长响应（流式）。
 */
export async function handleChair(
  dataDir: string,
  session: ConvectionSessionData,
  humanMessage: string,
  onEvent?: (ev: ConvectionStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  session.chairMessages.push({ role: 'user', content: humanMessage });

  const agent = await getAgent(dataDir, session.chairAgentId);
  const snapshot = formatPublicContext(session);
  const system: ContextMessage = {
    role: 'system',
    content: [
      `你是会长「${agent.name}」，不参与公共讨论，只在私聊中为人类出谋划策。`,
      `当前话题：「${session.topic}」`,
      '你可以看到公共对话的完整记录。基于对话内容和人类的问题给出参谋意见。',
      `\n--- 当前公共对话记录 ---\n${snapshot}\n--- 记录结束 ---`,
    ].join('\n'),
  };

  const msgs: ContextMessage[] = [system, ...session.chairMessages];

  const chairStart = Date.now();
  const abortCtrl = new AbortController();
  const chairTimer = setTimeout(() => abortCtrl.abort(), LLM_TIMEOUT_MS);
  // 外部 signal 级联到内部 abortCtrl
  const onAbort = () => abortCtrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let tokenReceived = false;

  const hbInterval = onEvent
    ? setInterval(() => {
        if (!tokenReceived) {
          onEvent({ type: 'heartbeat', label: agent.name, phase: 'llm-waiting', elapsed: Date.now() - chairStart });
        }
      }, HEARTBEAT_INTERVAL_MS)
    : null;

  const onChunk = onEvent
    ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'chair-token', chunk }); }
    : undefined;

  let reply: string;
  try {
    const r = await callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal: abortCtrl.signal });
    reply = r.content;
    updateSessionUsage(session, r.usage);
  } catch (e) {
    if (hbInterval) clearInterval(hbInterval);
    clearTimeout(chairTimer);
    signal?.removeEventListener('abort', onAbort);
    const msg = abortCtrl.signal.aborted
      ? `会长 LLM 响应超时（${LLM_TIMEOUT_MS / 1000}s），已中止`
      : (e as Error).message;
    onEvent?.({ type: 'error', message: msg });
    return;
  } finally {
    if (hbInterval) clearInterval(hbInterval);
    clearTimeout(chairTimer);
    signal?.removeEventListener('abort', onAbort);
  }

  session.chairMessages.push({ role: 'assistant', content: reply });
  onEvent?.({ type: 'chair-done', content: reply });
  await saveSession(dataDir, session);
}
