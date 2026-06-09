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
import { callLLM, type TokenUsage } from '../shared/llm-bridge';
import { loadAgent, type LoadedAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { buildSystemPrompt } from '../shared/prompt';
import { buildSandboxSection } from '../shared/sandbox-prompt';
import path from 'node:path';
import {
  runConvectionReAct,
  type ToolCallRecord,
  type ConvectionReActEvent,
} from './react-loop';

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
  | { type: 'error'; message: string };

export { ToolCallRecord };

/**
 * 构造参与 Agent 在对流中的 system prompt + 历史消息。
 */
async function buildAgentMessages(
  dataDir: string,
  session: ConvectionSessionData,
  agentId: string,
): Promise<{ messages: ContextMessage[]; agent: LoadedAgent }> {
  const agent = await getAgent(dataDir, agentId);
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  const wsPath = sessionWorkspace(dataDir, session.id);
  const projectDir = path.resolve(dataDir, '..');

  const participants = [];
  for (const pid of session.participantAgentIds) {
    const a = await getAgent(dataDir, pid);
    participants.push(a.name);
  }

  let systemText = '';
  if (agent.rolePrompt) systemText += agent.rolePrompt;
  if (toolDefs.length > 0) {
    systemText += '\n\n' + buildSystemPrompt(toolDefs);
  }
  systemText += '\n\n' + buildSandboxSection({
    workspaceAbs: wsPath,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '对流会话工作区',
  });
  systemText += `\n\n## 当前场景\n`;
  systemText += `你正以「${agent.name}」的身份参加一场多人对话。\n`;
  systemText += `参与者：${participants.join('、')}\n`;
  systemText += `话题：${session.topic}\n`;
  systemText += `请基于对话上下文回应人类的发言。简洁、有观点、有建设性。\n`;
  systemText += `工具调用过程不会展示给其他参与者，只有最终 <answer> 内容会被公开。`;

  const system: ContextMessage = { role: 'system', content: systemText };
  const history: ContextMessage = { role: 'user', content: formatPublicContext(session) };
  return { messages: [system, history], agent };
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
): Promise<void> {
  session.publicMessages.push({ speaker: '人类', content: humanMessage, timestamp: Date.now() });

  for (const agentId of session.participantAgentIds) {
    const agent = await getAgent(dataDir, agentId);
    onEvent?.({ type: 'agent-start', label: agent.name });

    const { messages, agent: loadedAgent } = await buildAgentMessages(dataDir, session, agentId);
    const result = await runConvectionReAct({
      dataDir,
      model: loadedAgent.model,
      temperature: loadedAgent.temperature,
      agentId,
      sessionId: session.id,
      label: loadedAgent.name,
      messages,
      onEvent: onEvent ? (ev) => {
        // 转换 ConvectionReActEvent → ConvectionStreamEvent
        if (ev.type === 'token') onEvent({ type: 'token', label: ev.label, chunk: ev.chunk! });
        else if (ev.type === 'tool-call') onEvent({ type: 'tool-call', label: ev.label, tool: ev.tool!, args: ev.args! });
        else if (ev.type === 'tool-result') onEvent({ type: 'tool-result', label: ev.label, tool: ev.tool!, result: ev.result! });
        else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', label: ev.label, phase: ev.phase!, elapsed: ev.elapsed! });
        else if (ev.type === 'error') onEvent({ type: 'error', message: ev.message! });
      } : undefined,
    });

    session.publicMessages.push({
      speaker: agent.name,
      content: result.cleanContent,
      timestamp: Date.now(),
      rawContent: result.rawContent || undefined,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    });
    updateSessionUsage(session, result.usage);
    onEvent?.({
      type: 'agent-done', label: agent.name,
      content: result.cleanContent, rawContent: result.rawContent, toolCalls: result.toolCalls,
    });
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
    const msg = abortCtrl.signal.aborted
      ? `会长 LLM 响应超时（${LLM_TIMEOUT_MS / 1000}s），已中止`
      : (e as Error).message;
    onEvent?.({ type: 'error', message: msg });
    return;
  } finally {
    if (hbInterval) clearInterval(hbInterval);
    clearTimeout(chairTimer);
  }

  session.chairMessages.push({ role: 'assistant', content: reply });
  onEvent?.({ type: 'chair-done', content: reply });
  await saveSession(dataDir, session);
}
