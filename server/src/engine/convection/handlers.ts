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
import {
  callLLM,
  resolveModelPromptBudget,
  resolveNativeMode,
  type TokenUsage,
} from '../shared/llm-bridge';
import { withAgentActivity } from '../shared/agent-activity.js';
import type { LoadedAgent } from '../shared/agent-loader';
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
} from './convection-react-adapter';
import { buildNativeConvectionProtocol, runConvectionReActNative } from './native-adapter';
import { appendConvectionReasoning, buildConvectionMessage } from './convection-reasoning';
import {
  buildConvectionChairPrompt,
  buildConvectionParticipantMeta,
} from './prompt-profiles.js';
import {
  buildConvectionMemoryPrompt,
  withConvectionMemoryTools,
} from './convection-memory.js';
import { runParticipantSequence } from './participant-sequence.js';
import { resolveConvectionPromptThreshold } from './convection-context-budget.js';
import { resolveConvectionContent } from './convection-outcome.js';
import { FrameworkError, type FrameworkErrorKind } from '../shared/framework-error.js';
import { frameworkTransportErrorFromUnknown } from '../shared/framework-error-transport.js';
import {
  loadRequiredAgent,
  loadRoundAgents,
  roundAgent,
  type RoundAgentSnapshot,
} from './round-agent-snapshot.js';

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

/** SSE 事件类型 */
export type ConvectionStreamEvent =
  | { type: 'agent-start'; agentId: string; label: string }
  | { type: 'token'; agentId: string; label: string; chunk: string }
  | { type: 'reasoning'; agentId: string; label: string; chunk: string }
  | { type: 'tool-call'; agentId: string; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; agentId: string; label: string; tool: string; result: string }
  | { type: 'agent-done'; agentId: string; label: string; content: string; rawContent: string; reasoning?: string; toolCalls: ToolCallRecord[] }
  | { type: 'agent-failed'; agentId: string; label: string; message: string; code?: string; kind?: FrameworkErrorKind }
  | { type: 'heartbeat'; agentId: string; label: string; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-reasoning'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedCycles: number; summaryLength: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind };

export { ToolCallRecord };

async function resolveSessionPromptThreshold(
  dataDir: string,
  session: ConvectionSessionData,
  agents: RoundAgentSnapshot,
): Promise<number | undefined> {
  const agentIds = [...session.participantAgentIds, session.chairAgentId];
  return resolveConvectionPromptThreshold(
    agentIds.map(id => roundAgent(agents, id).model),
    model => resolveModelPromptBudget(dataDir, model),
  );
}

async function compactPublicHistoryIfNeeded(
  dataDir: string,
  session: ConvectionSessionData,
  promptTokenThreshold: number | undefined,
  agents: RoundAgentSnapshot,
  onEvent?: (event: ConvectionStreamEvent) => void,
): Promise<void> {
  const promptTokens = session.tokenUsage?.promptTokens;
  if (!promptTokens) return;
  const state: ConvectionCompactState = session.compactState ?? { disabled: false, archiveSeq: 0 };
  const chairAgent = roundAgent(agents, session.chairAgentId);
  const participants = session.participantAgentIds.map(id => roundAgent(agents, id));
  const compacted = await compactConvectionIfNeeded(session.publicMessages, promptTokens, state, {
    dataDir,
    chairModel: chairAgent.model,
    archiveDir: path.join(sessionWorkspace(dataDir, session.id), 'bak'),
    participants: participants.map(agent => agent.name),
    promptTokenThreshold,
    onEvent: event => forwardCompactEvent(event, onEvent),
  });
  session.compactState = state;
  if (compacted) session.tokenUsage = undefined;
  await saveSession(dataDir, session);
}

function forwardCompactEvent(
  event: { type: string; archivedCycles?: number; summaryLength?: number; message?: string },
  onEvent?: (event: ConvectionStreamEvent) => void,
): void {
  if (event.type === 'compact-start') onEvent?.({ type: 'compact-start' });
  if (event.type === 'compact-done') onEvent?.({
    type: 'compact-done',
    archivedCycles: event.archivedCycles!,
    summaryLength: event.summaryLength!,
  });
  if (event.type === 'compact-warn') onEvent?.({ type: 'error', message: event.message! });
}

/**
 * 构造参与 Agent 在对流中的 system prompt + 历史消息。
 * 组装顺序：元认知 → 空间+权限 → 角色 → 基线 → 协议 → 场景上下文
 */
async function buildAgentMessages(
  dataDir: string,
  session: ConvectionSessionData,
  agent: LoadedAgent,
  native?: boolean,
): Promise<{ messages: ContextMessage[]; agent: LoadedAgent; toolDefs: ToolDef[] }> {
  const toolDefs = withConvectionMemoryTools(
    await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode),
  );
  const wsPath = sessionWorkspace(dataDir, session.id);
  const projectDir = path.resolve(dataDir, '..');

  // 读对流自己的 baseline.md
  const selfDir = path.dirname(fileURLToPath(import.meta.url));

  const parts: string[] = [];

  // 1. 共同元认知 + 对流参与者身份
  parts.push(buildConvectionParticipantMeta());

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

  // 5. 当前参与 Agent 的私有长期记忆；按会议话题和最近人类输入相关召回。
  const latestHuman = [...session.publicMessages].reverse().find(message => message.speaker === '人类');
  const memorySection = await buildConvectionMemoryPrompt(
    dataDir,
    agent.id,
    [session.topic, latestHuman?.content].filter(Boolean).join('\n'),
  );
  if (memorySection.trim()) parts.push(memorySection.trim());

  // 6. 协议段
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeConvectionProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  // 7. 场景上下文
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
  await saveSession(dataDir, session);
  const agents = await loadRoundAgents(
    dataDir,
    [...session.participantAgentIds, session.chairAgentId],
  );
  const promptTokenThreshold = await resolveSessionPromptThreshold(dataDir, session, agents);
  await compactPublicHistoryIfNeeded(dataDir, session, promptTokenThreshold, agents, onEvent);

  await runParticipantSequence({
    participantIds: session.participantAgentIds,
    signal,
    execute: async (agentId) => {
    const agent = roundAgent(agents, agentId);
    onEvent?.({ type: 'agent-start', agentId, label: agent.name });

    // 每个 agent 各自决议原生模式（model 可能不同）
    const nativeDecision = await resolveNativeMode(dataDir, agent.model);
    console.log(`[convection] ${agent.name} (${agent.model}) → tools=${nativeDecision.native ? 'structured' : 'text'}`);

    let reasoningContent = '';
    const result = await withAgentActivity(agentId, 'convection', async () => {
      if (nativeDecision.native) {
        // 原生模式：adapter 注入共享 runReActLoopNative
        const { messages, agent: loadedAgent, toolDefs } = await buildAgentMessages(dataDir, session, agent, true);
        return await runConvectionReActNative({
          dataDir,
          model: loadedAgent.model,
          temperature: loadedAgent.temperature,
          agentId,
          sessionId: session.id,
          label: loadedAgent.name,
          messages,
          toolDefs,
          onEvent: (ev) => {
            if (ev.type === 'reasoning') reasoningContent = appendConvectionReasoning(reasoningContent, ev.chunk!);
            if (!onEvent) return;
            if (ev.type === 'token') onEvent({ type: 'token', agentId, label: ev.label, chunk: ev.chunk! });
            else if (ev.type === 'reasoning') onEvent({ type: 'reasoning', agentId, label: ev.label, chunk: ev.chunk! });
            else if (ev.type === 'tool-call') onEvent({ type: 'tool-call', agentId, label: ev.label, tool: ev.tool!, args: ev.args! });
            else if (ev.type === 'tool-result') onEvent({ type: 'tool-result', agentId, label: ev.label, tool: ev.tool!, result: ev.result! });
            else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', agentId, label: ev.label, phase: ev.phase!, elapsed: ev.elapsed! });
          },
          signal,
        });
      } else {
        // JSON 文本工具模式
        const { messages, agent: loadedAgent, toolDefs } = await buildAgentMessages(dataDir, session, agent, false);
        return await runConvectionReAct({
          dataDir,
          model: loadedAgent.model,
          temperature: loadedAgent.temperature,
          agentId,
          sessionId: session.id,
          label: loadedAgent.name,
          messages,
          allowedTools: toolDefs.map(tool => tool.name),
          onEvent: (ev) => {
            if (ev.type === 'reasoning') reasoningContent = appendConvectionReasoning(reasoningContent, ev.chunk!);
            if (!onEvent) return;
            if (ev.type === 'token') onEvent({ type: 'token', agentId, label: ev.label, chunk: ev.chunk! });
            else if (ev.type === 'reasoning') onEvent({ type: 'reasoning', agentId, label: ev.label, chunk: ev.chunk! });
            else if (ev.type === 'tool-call') onEvent({ type: 'tool-call', agentId, label: ev.label, tool: ev.tool!, args: ev.args! });
            else if (ev.type === 'tool-result') onEvent({ type: 'tool-result', agentId, label: ev.label, tool: ev.tool!, result: ev.result! });
            else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', agentId, label: ev.label, phase: ev.phase!, elapsed: ev.elapsed! });
          },
          signal,
        });
      }
    });

    // abort 时保留已流式产出的有效内容
    const content = resolveConvectionContent(result.cleanContent, result.termination);
    if (content) {
      session.publicMessages.push(buildConvectionMessage({
        agentId,
        speaker: agent.name,
        content,
        timestamp: Date.now(),
        rawContent: result.rawContent || undefined,
        reasoning: reasoningContent || undefined,
        toolCalls: result.toolCalls,
      }));
      updateSessionUsage(session, result.usage);
      onEvent?.({
        type: 'agent-done', agentId, label: agent.name,
        content, rawContent: result.rawContent, reasoning: reasoningContent || undefined, toolCalls: result.toolCalls,
      });
    }
    },
    commit: async () => { await saveSession(dataDir, session); },
    reportFailure: async (agentId, error) => {
      const agent = agents.get(agentId);
      const failure = frameworkTransportErrorFromUnknown(error, 'convection.participant');
      onEvent?.({
        type: 'agent-failed',
        agentId,
        label: agent?.name ?? agentId,
        message: failure.message,
        code: failure.code,
        kind: failure.kind,
      });
      await saveSession(dataDir, session);
    },
  });

  await compactPublicHistoryIfNeeded(dataDir, session, promptTokenThreshold, agents, onEvent);
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

  const agent = await loadRequiredAgent(dataDir, session.chairAgentId);
  const snapshot = formatPublicContext(session);
  const system: ContextMessage = {
    role: 'system',
    content: buildConvectionChairPrompt({
      chairName: agent.name,
      topic: session.topic,
      publicContext: snapshot,
    }),
  };

  const msgs: ContextMessage[] = [system, ...session.chairMessages];

  const chairStart = Date.now();
  const abortCtrl = new AbortController();
  let timedOut = false;
  const chairTimer = setTimeout(() => {
    timedOut = true;
    abortCtrl.abort();
  }, LLM_TIMEOUT_MS);
  // 外部 signal 级联到内部 abortCtrl
  const onAbort = () => abortCtrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let tokenReceived = false;

  const hbInterval = onEvent
    ? setInterval(() => {
        if (!tokenReceived) {
          onEvent({ type: 'heartbeat', agentId: agent.id, label: agent.name, phase: 'llm-waiting', elapsed: Date.now() - chairStart });
        }
      }, HEARTBEAT_INTERVAL_MS)
    : null;

  const onChunk = onEvent
    ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'chair-token', chunk }); }
    : undefined;
  const onReasoning = onEvent
    ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'chair-reasoning', chunk }); }
    : undefined;

  let reply: string;
  try {
    const r = await withAgentActivity(session.chairAgentId, 'convection', () => (
      callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal: abortCtrl.signal, onReasoning })
    ));
    reply = r.content.trim();
    if (!reply) {
      throw new FrameworkError({
        code: 'MODEL_EMPTY_RESPONSE', kind: 'protocol', message: '模型返回空响应',
        source: 'convection.chair', retryable: false,
      });
    }
    updateSessionUsage(session, r.usage);
  } catch (e) {
    if (signal?.aborted) return;
    const typed = timedOut
      ? new FrameworkError({
          code: 'MODEL_TIMEOUT', kind: 'timeout',
          message: `会议助理响应超时（${LLM_TIMEOUT_MS / 1000}s）`,
          source: 'convection.chair', retryable: false,
        }, { cause: e })
      : e instanceof FrameworkError
        ? e
        : new FrameworkError({
            code: 'MODEL_REQUEST_FAILED', kind: 'provider', message: '模型请求失败',
            source: 'convection.chair', retryable: false,
          }, { cause: e });
    throw typed;
  } finally {
    if (hbInterval) clearInterval(hbInterval);
    clearTimeout(chairTimer);
    signal?.removeEventListener('abort', onAbort);
  }

  session.chairMessages.push({ role: 'assistant', content: reply });
  onEvent?.({ type: 'chair-done', content: reply });
  await saveSession(dataDir, session);
}
