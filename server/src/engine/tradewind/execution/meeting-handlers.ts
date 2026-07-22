/**
 * 信风 Meeting Handlers（从对流 handlers.ts 复制解耦）
 *
 * 职责：
 * - handleSpeak：人类发言 → 参与 Agent 串行响应
 * - handleChair：人类给会长发消息 → 会长响应
 * - handleEnd：人类结束会议 → 会长生成纪要
 *
 * 与对流的差异：
 * - 无文件持久化（内存态 MeetingSessionData）
 * - 工具调用走信风的 execTool（HTTP /api/tools/exec）
 * - workspace 指向 runDir 下
 * - 会长纪要作为 meeting 节点的输出内容
 *
 * 信风独立副本，可自主演进。
 */

import type { ContextMessage } from '../../shared/types';
import type { MeetingSessionData, MeetingMessage } from './meeting-session';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callLLM, resolveNativeMode } from '../../shared/llm-bridge';
import { loadAgent, type LoadedAgent } from '../../shared/agent-loader';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader';
import { buildSystemPrompt } from '../../shared/prompt';
import { buildSandboxSection } from '../../shared/sandbox-prompt';
import {
  runReActLoop,
  stripInternalTags,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { extractAnswer } from '../../shared/answer-extractor';
import { activeNodeRunners } from '../nodes/agent';
import { runTradewindReActNative } from './native-adapter';
import { buildVirtualToolDefs } from './virtual-tools';
import { appendMeetingReasoning } from './meeting-reasoning';
import { createMeetingIdleGuard, MEETING_IDLE_TIMEOUT_MS } from './meeting-idle-guard';

/** 读取会议室元认知段（meeting-meta.md，与本文件同级）。读不到则静默跳过。 */
function loadMeetingMeta(): string {
  try {
    const metaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'meeting-meta.md');
    return readFileSync(metaPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

// ── 常量 ──────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = 3_600_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

// ── 事件类型 ──────────────────────────────────────────────────────

export type MeetingStreamEvent =
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'reasoning'; label: string; chunk: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; label: string; tool: string; result: string; meta?: unknown }
  | { type: 'heartbeat'; label: string; phase: string; elapsed: number }
  | { type: 'contact-start'; label: string; target: string }
  | { type: 'contact-done'; label: string; target: string; result: string; ok: boolean }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; reasoning?: string; toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string; meta?: unknown }>; noReply?: boolean }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-reasoning'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'minutes-done'; content: string }
  | { type: 'error'; message: string };

// ── 辅助 ──────────────────────────────────────────────────────────

function formatPublicContext(session: MeetingSessionData): string {
  if (session.publicMessages.length === 0) return '（暂无发言）';
  return session.publicMessages
    .map(m => `[${m.speaker}] ${m.content}`)
    .join('\n\n');
}

async function execTool(
  tool: string,
  args: Record<string, string>,
  agentId: string,
  workspace: string,
  signal?: AbortSignal,
  onMeta?: (meta: unknown) => void,
): Promise<string> {
  const { execToolUnified } = await import('../../shared/exec-tool');
  return execToolUnified({ tool, args, agentId, workspaceDir: workspace, signal, onMeta });
}

/**
 * 会议室内 contact：联络 agent 节点。
 * 标头格式：[系统信息：来自会议室「xxx」- 协作者「yyy」的联络]
 */
async function execMeetingContact(
  args: Record<string, string>,
  senderLabel: string,
  meetingLabel: string,
  signal?: AbortSignal,
): Promise<string> {
  const { findRunnerByLabel, tryRegisterWait, clearWait } = await import('./contact-registry');

  const target = args.target || '';
  const message = args.message || '';

  const found = findRunnerByLabel(target);
  if (!found) {
    return `联络失败：找不到名为「${target}」的协作者。请检查可联络的节点名称。`;
  }

  // 死锁检测（用会议室 nodeId 占位——这里无 nodeId，用 meetingLabel 做 key）
  const sourceKey = `meeting:${meetingLabel}:${senderLabel}`;
  const canWait = tryRegisterWait(sourceKey, found.nodeId);
  if (!canWait) {
    return `联络被系统拒绝：「${target}」当前正在等待你的回复，反向联络会造成死锁。`;
  }

  try {
    const contactContent = `[系统信息：来自会议室「${meetingLabel}」- 协作者「${senderLabel}」的联络]\n\n${message}`;

    const answer = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('contact 超时（20 分钟未响应）'));
      }, 20 * 60 * 1000);

      found.runner.push({
        source: 'contact',
        content: contactContent,
        onComplete: (output) => {
          clearTimeout(timeout);
          resolve(output);
        },
      });

      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('会议已中止'));
      }, { once: true });
    });

    return `[来自「${target}」的回复]\n\n${answer}`;
  } catch (e) {
    return `联络「${target}」失败：${(e as Error).message}`;
  } finally {
    clearWait(sourceKey);
  }
}

// ── handleSpeak ───────────────────────────────────────────────────

export interface HandleSpeakOpts {
  dataDir: string;
  workspace: string;
  session: MeetingSessionData;
  humanMessage: string;
  signal?: AbortSignal;
  onEvent?: (ev: MeetingStreamEvent) => void;
  /** 工作流团队名册（用于 contact 工具说明） */
  teamRoster?: Array<{ label: string; role: string }>;
}

/**
 * 人类发言 → 参与 Agent 串行响应。
 * 每个 Agent 跑信风的 react-loop（带工具能力）。
 * 返回最后一个 Agent 的 promptTokens（用于压缩阈值判断）。
 */
export async function handleSpeak(opts: HandleSpeakOpts): Promise<number | undefined> {
  const { dataDir, workspace, session, humanMessage, signal, onEvent, teamRoster } = opts;

  session.publicMessages.push({ speaker: '人类', content: humanMessage, timestamp: Date.now() });
  session.round++;
  session.busy = true;
  let lastPromptTokens: number | undefined;

  try {
    for (const participant of session.participants) {
      if (signal?.aborted) break;

      const agent = await loadAgent(dataDir, participant.agentId);
      if (!agent) continue;

      const label = participant.label;
      const idleGuard = createMeetingIdleGuard(signal);
      session.streamingCurrent = { speaker: label, content: '', reasoning: '' };
      onEvent?.({ type: 'agent-start', label });

      const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);

      // native 模式决议（按 agent.model 决定，每个参与者独立判断）
      const nativeDecision = await resolveNativeMode(dataDir, agent.model);

      // 构造 system prompt（参与者列表用 label）
      const participantLabels = session.participants.map(p => p.label);
      const contactTargetsForPrompt = session.participants
        .filter(p => p.label !== label)
        .map(p => ({ label: p.label, role: '会议参与者' }));

      const systemText = buildMeetingAgentPrompt(
        agent,
        participantLabels,
        session,
        toolDefs,
        workspace,
        label,
        session.meetingLabel,
        dataDir,
        contactTargetsForPrompt,
        nativeDecision.native,
      );
      const history = formatPublicContext(session);
      const messages: ContextMessage[] = [
        { role: 'system', content: systemText },
        { role: 'user', content: history },
      ];

      // toolCaller：双路径共用，contact 路由不变
      //
      // tool-call/tool-result 事件来源：
      // - text 路径：由 runReActLoop 内部 emit（react-loop.ts），handleSpeak 在 onEvent 里翻译
      // - native 路径：runReActLoopNative 内部不发 tool-* 事件，需 toolCaller 自己 emit
      //
      // 为避免 text 路径下重复事件，emitToolEvents 仅在 native 路径下为 true。
      const emitToolEvents = nativeDecision.native;
      const toolCaller: ToolCaller | undefined = toolDefs.length > 0 || nativeDecision.native ? {
        async call(tool, args, onMeta) {
          // contact 假工具：联络 agent 节点（自带 contact-start/contact-done 事件，不发 tool-* 事件）
          if (tool === 'contact') {
            const target = args.target || '';
            onEvent?.({ type: 'contact-start', label, target });
            const result = await execMeetingContact(args, label, session.meetingLabel, idleGuard.signal);
            idleGuard.touch();
            const ok = !result.startsWith('联络失败') && !result.startsWith('联络被系统拒绝') && !result.includes('失败');
            onEvent?.({ type: 'contact-done', label, target, result, ok });
            return result;
          }
          // 普通工具
          if (emitToolEvents) onEvent?.({ type: 'tool-call', label, tool, args });
          try {
            let meta: unknown;
            const result = await execTool(tool, args, participant.agentId, workspace, idleGuard.signal, (m) => {
              meta = m;
              onMeta?.(m);
            });
            if (emitToolEvents) onEvent?.({ type: 'tool-result', label, tool, result, meta });
            return result;
          } catch (e) {
            const err = `错误：${(e as Error).message}`;
            if (emitToolEvents) onEvent?.({ type: 'tool-result', label, tool, result: err });
            return err;
          }
        },
      } : undefined;

      // 双路径分流执行
      let result: { content: string; rawContent: string; toolCalls: Array<{ tool: string; args: Record<string, string>; result: string; meta?: unknown }>; lastPromptTokens?: number };

      try {
      if (nativeDecision.native) {
        // ── native 路径 ──
        // 虚拟工具 schema 注入（contact 必备；meeting 不允许 delegate）
        const virtualDefs = buildVirtualToolDefs({
          allowDelegate: false,
          contactTargets: session.participants.filter(p => p.label !== label).map(p => p.label),
        });
        const allToolDefs = [...toolDefs, ...virtualDefs];

        const nativeResult = await runTradewindReActNative({
          dataDir,
          model: agent.model,
          temperature: agent.temperature ?? 0.7,
          messages,
          toolDefs: allToolDefs,
          toolCaller: toolCaller!,
          // 事件翻译：NodeRunnerEvent → MeetingStreamEvent（补 label）
          // 注意：tool-call/tool-result 由 toolCaller 内部 emit（contact-* 事件），
          // adapter 自身只 emit token / error，这里只翻译这两类
          onEvent: (ev) => {
            if (ev.type === 'token') {
              idleGuard.touch();
              if (session.streamingCurrent) session.streamingCurrent.content += ev.content;
              onEvent?.({ type: 'token', label, chunk: ev.content });
            } else if (ev.type === 'reasoning') {
              idleGuard.touch();
              if (session.streamingCurrent) appendMeetingReasoning(session.streamingCurrent, ev.content);
              onEvent?.({ type: 'reasoning', label, chunk: ev.content });
            } else if (ev.type === 'error') {
              onEvent?.({ type: 'error', message: ev.message });
            }
          },
          signal: idleGuard.signal,
        });

        result = {
          content: nativeResult.content,
          rawContent: nativeResult.rawContent,
          toolCalls: nativeResult.toolCalls,
          lastPromptTokens: nativeResult.lastPromptTokens,
        };
      } else {
        // ── text 路径（原有逻辑）──
        const llm: LLMCaller = {
          async call(msgs, _opts, onChunk, sig, onReasoning) {
            return callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal: sig, onReasoning });
          },
        };

        const textResult = await runReActLoop({
          messages,
          llm,
          tools: toolCaller,
          maxTurns: 100,
          onEvent: (ev) => {
            if (ev.type === 'token') {
              idleGuard.touch();
              if (session.streamingCurrent) session.streamingCurrent.content += ev.chunk;
              onEvent?.({ type: 'token', label, chunk: ev.chunk });
            }
            if (ev.type === 'reasoning') {
              idleGuard.touch();
              if (session.streamingCurrent) appendMeetingReasoning(session.streamingCurrent, ev.chunk);
              onEvent?.({ type: 'reasoning', label, chunk: ev.chunk });
            }
            if (ev.type === 'heartbeat') onEvent?.({ type: 'heartbeat', label, phase: ev.phase, elapsed: ev.elapsed });
            if (ev.type === 'tool-call') onEvent?.({ type: 'tool-call', label, tool: ev.tool, args: ev.args });
            if (ev.type === 'tool-result') onEvent?.({ type: 'tool-result', label, tool: ev.tool, result: ev.result, meta: ev.meta });
          },
          signal: idleGuard.signal,
        });
        result = {
          content: textResult.content,
          rawContent: textResult.rawContent,
          toolCalls: textResult.toolCalls,
          lastPromptTokens: textResult.lastPromptTokens,
        };
      }
      } finally {
        idleGuard.dispose();
      }

      // 记录最后一个 participant 的 promptTokens
      if (result.lastPromptTokens) lastPromptTokens = result.lastPromptTokens;

      // 最终内容提取 + abort 回填
      // - native 模式：直接取 result.content（无 <answer> 概念），仅 stripInternalTags 兜底
      // - text 模式：abort 时用流式累积内容 + extractAnswer/stripInternalTags 兜底
      const aborted = signal?.aborted;
      if (idleGuard.timedOut()) {
        onEvent?.({ type: 'error', message: `LLM 静默超时（${MEETING_IDLE_TIMEOUT_MS / 1000}s 无响应）` });
      }
      const streamedContent = session.streamingCurrent?.content?.trim() || '';
      const reasoning = session.streamingCurrent?.reasoning || undefined;
      let finalContent: string;
      if (nativeDecision.native) {
        const source = aborted ? streamedContent : result.content;
        finalContent = stripInternalTags(source).trim();
      } else {
        finalContent = aborted
          ? (extractAnswer(streamedContent) ?? stripInternalTags(streamedContent).trim())
          : result.content;
      }

      const hasContent = !!finalContent && !finalContent.startsWith('[中止]') && !finalContent.startsWith('[错误]');
      if (hasContent) {
        session.publicMessages.push({
          speaker: label,
          content: finalContent,
          timestamp: Date.now(),
          rawContent: result.rawContent || undefined,
          reasoning,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        });
      } else if (!aborted) {
        // 无有效回复：显式入库一条 noReply 消息（对齐信封轮的兜底做法）。
        // 让 round-done 权威快照带上它——既向用户呈现"未回复"，也让前端任何
        // 遗留的 streaming 占位气泡在快照替换时被自愈清除（不再永久转圈）。
        session.publicMessages.push({
          speaker: label,
          content: `（${label} 未回复）`,
          timestamp: Date.now(),
          noReply: true,
        });
      }
      session.streamingCurrent = undefined;
      onEvent?.({ type: 'agent-done', label, content: finalContent, rawContent: result.rawContent, reasoning, toolCalls: result.toolCalls, noReply: !hasContent && !aborted });

      if (aborted) break;
    }
  } finally {
    session.busy = false;
    session.streamingCurrent = undefined;
  }
  return lastPromptTokens;
}

// ── handleChair ───────────────────────────────────────────────────

export interface HandleChairOpts {
  dataDir: string;
  session: MeetingSessionData;
  humanMessage: string;
  signal?: AbortSignal;
  onEvent?: (ev: MeetingStreamEvent) => void;
}

/** 人类给会长发消息 → 会长响应（流式） */
export async function handleChair(opts: HandleChairOpts): Promise<void> {
  const { dataDir, session, humanMessage, signal, onEvent } = opts;

  session.chairMessages.push({ role: 'user', content: humanMessage });

  const agent = await loadAgent(dataDir, session.chairAgentId);
  if (!agent) { onEvent?.({ type: 'error', message: '会长 Agent 不存在' }); return; }

  const snapshot = formatPublicContext(session);
  const system: ContextMessage = {
    role: 'system',
    content: [
      `你是会议室节点「${session.meetingLabel}」的会长「${agent.name}」，正在与人类**私聊**。`,
      ``,
      `## 当前场景`,
      `- 这条通道只有你和人类，其他参与者看不到`,
      `- 你能看到完整的公共对话记录`,
      `- 你的角色是参谋：分析对话、指出问题、给人类出主意`,
      ``,
      `话题：${session.topic}`,
      ``,
      `--- 当前公共对话记录 ---`,
      snapshot,
      `--- 记录结束 ---`,
    ].join('\n'),
  };

  const msgs: ContextMessage[] = [system, ...session.chairMessages];

  const onChunk = onEvent
    ? (chunk: string) => { onEvent({ type: 'chair-token', chunk }); }
    : undefined;
  const onReasoning = onEvent
    ? (chunk: string) => { onEvent({ type: 'chair-reasoning', chunk }); }
    : undefined;
  const idleGuard = createMeetingIdleGuard(signal);

  try {
    const r = await callLLM({
      dataDir,
      fullModelKey: agent.model,
      messages: msgs,
      onChunk: onChunk ? (chunk) => { idleGuard.touch(); onChunk(chunk); } : undefined,
      onReasoning: onReasoning ? (chunk) => { idleGuard.touch(); onReasoning(chunk); } : undefined,
      signal: idleGuard.signal,
    });
    session.chairMessages.push({ role: 'assistant', content: r.content });
    onEvent?.({ type: 'chair-done', content: r.content });
  } catch (e) {
    const message = idleGuard.timedOut()
      ? `LLM 静默超时（${MEETING_IDLE_TIMEOUT_MS / 1000}s 无响应）`
      : (e as Error).message;
    onEvent?.({ type: 'error', message });
  } finally {
    idleGuard.dispose();
  }
}

// ── handleMeetingOpen ─────────────────────────────────────────────

export interface HandleMeetingOpenOpts {
  dataDir: string;
  workspace: string;
  session: MeetingSessionData;
  /** 上游信封内容（已拼接） */
  envelopeContent: string;
  signal?: AbortSignal;
  onEvent?: (ev: MeetingStreamEvent) => void;
}

/**
 * 入会摘要阶段。
 * 1. 信封内容 push 到 publicMessages（speaker = '[系统信息]'）
 * 2. 串行让每位 participant 调 LLM 生成入会发言
 *    - 有历史（NodeRunner 中存在非 system 消息）→ 总结进展
 *    - 无历史 → 自我介绍 + 初步立场
 * 3. 完成后 session.phase = 'discussion'
 */
export async function handleMeetingOpen(opts: HandleMeetingOpenOpts): Promise<void> {
  const { dataDir, session, envelopeContent, signal, onEvent } = opts;

  // 信封作为系统信息进入公共上下文
  session.publicMessages.push({
    speaker: '[系统信息]',
    content: envelopeContent || '（信封内容为空）',
    timestamp: Date.now(),
  });

  const participantLabels = session.participants.map(p => p.label);

  for (const participant of session.participants) {
    if (signal?.aborted) return;

    const label = participant.label;
    const agent = await loadAgent(dataDir, participant.agentId);
    if (!agent) {
      session.publicMessages.push({
        speaker: label,
        content: `（${label} 入会失败：Agent 实体不存在）`,
        timestamp: Date.now(),
      });
      continue;
    }

    // 读取该参与者 NodeRunner 当下的上下文快照（剔除 system）
    const runner = activeNodeRunners.get(participant.nodeId);
    const history = runner
      ? runner.getMessages().filter(m => m.role !== 'system')
      : [];

    const systemText = history.length > 0
      ? buildOpeningPromptWithHistory(agent.name, agent.rolePrompt, label, session, participantLabels, history)
      : buildOpeningPromptNoHistory(agent.name, agent.rolePrompt, label, session, participantLabels);

    const messages: ContextMessage[] = [
      { role: 'system', content: systemText },
      { role: 'user', content: '请按上述要求给出你的入会发言。' },
    ];

    onEvent?.({ type: 'agent-start', label });

    // 先 push 占位消息，token 流式直接累加进这条消息（前端轮询可实时看到字符增长）
    const placeholderIdx = session.publicMessages.length;
    session.publicMessages.push({
      speaker: label,
      content: '',
      timestamp: Date.now(),
      streaming: true,
    });
    const idleGuard = createMeetingIdleGuard(signal);

    try {
      let streamRaw = '';
      const r = await callLLM({
        dataDir,
        fullModelKey: agent.model,
        messages,
        onChunk: (chunk) => {
          idleGuard.touch();
          streamRaw += chunk;
          // 实时更新占位消息的内容（含 <think> 等原始流，前端可看到全过程）
          const slot = session.publicMessages[placeholderIdx];
          if (slot) slot.content = streamRaw;
          onEvent?.({ type: 'token', label, chunk });
        },
        onReasoning: (chunk) => {
          idleGuard.touch();
          const slot = session.publicMessages[placeholderIdx];
          if (slot) appendMeetingReasoning(slot, chunk);
          onEvent?.({ type: 'reasoning', label, chunk });
        },
        signal: idleGuard.signal,
      });
      const answer = extractAnswer(r.content) ?? stripInternalTags(r.content).trim();
      const finalContent = answer || `（${label} 未给出有效入会发言）`;
      // 定稿：content 替换为 answer，rawContent 保留完整流，streaming=false
      const slot = session.publicMessages[placeholderIdx];
      if (slot) {
        slot.content = finalContent;
        slot.rawContent = r.content;
        slot.timestamp = Date.now();
        slot.streaming = false;
      }
      onEvent?.({ type: 'agent-done', label, content: finalContent, rawContent: r.content, reasoning: slot?.reasoning });
    } catch (e) {
      if ((e as Error).name === 'AbortError' && signal?.aborted) return;
      const reason = idleGuard.timedOut() ? `静默超时（${MEETING_IDLE_TIMEOUT_MS / 1000}s）` : (e as Error).message;
      const errText = `（${label} 入会摘要生成失败：${reason}）`;
      const slot = session.publicMessages[placeholderIdx];
      if (slot) {
        slot.content = errText;
        slot.streaming = false;
      }
      onEvent?.({ type: 'agent-done', label, content: errText });
    } finally {
      idleGuard.dispose();
    }
  }

  session.phase = 'discussion';
}

function buildOpeningPromptWithHistory(
  agentName: string,
  rolePrompt: string,
  selfLabel: string,
  session: MeetingSessionData,
  participantLabels: string[],
  history: readonly ContextMessage[],
): string {
  const otherLabels = participantLabels.filter(l => l !== selfLabel).join('、') || '（仅你一人）';

  // 历史截断：从尾部累加到 60K 字符上限，保留最近内容
  // 200K token 上下文模型下，留 130K+ token 给后续会议轮次累积
  const HISTORY_CHAR_LIMIT = 60_000;
  const truncated = truncateHistoryFromTail(history, HISTORY_CHAR_LIMIT);
  const omittedNote = truncated.omittedCount > 0
    ? `[早期 ${truncated.omittedCount} 条对话已省略，仅保留最近内容]\n\n`
    : '';
  const historyText = omittedNote + truncated.kept
    .map(m => `[${m.role}]\n${m.content}`)
    .join('\n\n---\n\n');

  return [
    rolePrompt ? `# 角色\n\n${rolePrompt}\n\n---\n` : '',
    `# 入会发言`,
    ``,
    `你（${agentName}，会议身份「${selfLabel}」）即将参加会议《${session.meetingLabel}》。`,
    ``,
    `## 会议元信息`,
    `- 话题：${session.topic}`,
    `- 其他参与者：${otherLabels}`,
    ``,
    `## 你目前在工作流中的对话历史`,
    `（上游传来的信封内容已发布到会议公共消息中，下面是你的私有上下文）`,
    ``,
    `---`,
    historyText,
    `---`,
    ``,
    `## 任务`,
    `作为入会发言，用 100-300 字总结：`,
    `1. 你目前的工作进展和已完成的事情`,
    `2. 与本次会议话题相关的已有思考、结论或立场`,
    ``,
    `## 输出约束`,
    `- 用 <answer>...</answer> 包裹最终发言`,
    `- 不要调用任何工具`,
    `- 直接进入正题，不要寒暄`,
  ].filter(Boolean).join('\n');
}

/**
 * 历史截断：从尾部往前累加，超过字符上限即停止
 * 返回保留的消息（按原顺序）+ 被省略的消息数
 */
function truncateHistoryFromTail(
  history: readonly ContextMessage[],
  charLimit: number,
): { kept: ContextMessage[]; omittedCount: number } {
  const kept: ContextMessage[] = [];
  let chars = 0;
  // 从尾部往前累加
  for (let i = history.length - 1; i >= 0; i--) {
    const msgChars = history[i].content.length + 8; // 8 ≈ [role]\n 标记开销
    if (chars + msgChars > charLimit && kept.length > 0) break;
    kept.unshift(history[i]);
    chars += msgChars;
  }
  return { kept, omittedCount: history.length - kept.length };
}

function buildOpeningPromptNoHistory(
  agentName: string,
  rolePrompt: string,
  selfLabel: string,
  session: MeetingSessionData,
  participantLabels: string[],
): string {
  const otherLabels = participantLabels.filter(l => l !== selfLabel).join('、') || '（仅你一人）';
  return [
    rolePrompt ? `# 角色\n\n${rolePrompt}\n\n---\n` : '',
    `# 入会发言`,
    ``,
    `你（${agentName}，会议身份「${selfLabel}」）即将参加会议《${session.meetingLabel}》。`,
    ``,
    `## 会议元信息`,
    `- 话题：${session.topic}`,
    `- 其他参与者：${otherLabels}`,
    ``,
    `上游传来的信封内容已发布到会议公共消息中。`,
    `你刚刚被激活，目前还未在工作流中处理过任何任务。`,
    ``,
    `## 任务`,
    `作为入会发言，基于你的角色定位和会议话题，用 100-200 字给出：`,
    `1. 简短的自我介绍（你是谁、擅长什么）`,
    `2. 对本次话题的初步立场或思考方向`,
    ``,
    `## 输出约束`,
    `- 用 <answer>...</answer> 包裹最终发言`,
    `- 不要调用任何工具`,
    `- 直接进入正题，不要寒暄`,
  ].filter(Boolean).join('\n');
}

// ── handleEnd ─────────────────────────────────────────────────────
export interface HandleEndOpts {
  dataDir: string;
  session: MeetingSessionData;
  /** 团队名册（label + role），用于纪要中注入团队结构 */
  teamRoster?: Array<{ label: string; role: string }>;
  signal?: AbortSignal;
  onEvent?: (ev: MeetingStreamEvent) => void;
}

export interface MeetingEndResult {
  /** 会长生成的纪要全文 */
  minutes: string;
  /** 完整对话快照（已格式化为 [说话人] 内容） */
  transcript: string;
}

/** 人类结束会议 → 会长生成纪要 → 返回纪要 + 完整对话快照 */
export async function handleEnd(opts: HandleEndOpts): Promise<MeetingEndResult> {
  const { dataDir, session, teamRoster, signal, onEvent } = opts;

  const agent = await loadAgent(dataDir, session.chairAgentId);
  if (!agent) throw new Error('会长 Agent 不存在');

  const transcript = formatPublicContext(session);
  const participantLabels = session.participants.map(p => p.label).join('、');

  // 团队名册段（如果传入了 roster）
  const rosterSection = teamRoster && teamRoster.length > 0
    ? [
        ``,
        `## 团队名册（完整工作流协作者）`,
        ...teamRoster.map(m => `- ${m.label}：${m.role}`),
        ``,
      ].join('\n')
    : '';

  const system: ContextMessage = {
    role: 'system',
    content: [
      `你是会议室节点「${session.meetingLabel}」的会长「${agent.name}」。会议已结束，请生成完整、详尽的会议纪要。`,
      ``,
      `这份纪要会自动注入所有参与者的工作上下文，作为他们后续工作流任务的核心指导依据。`,
      `信息完整性优先于简洁性。`,
      ``,
      `## 会议元信息`,
      `- 话题：${session.topic}`,
      `- 参与者：${participantLabels}`,
      `- 总轮次：${session.round}`,
      `- 总发言数：${session.publicMessages.length}`,
      rosterSection,
      ``,
      `## 完整对话记录`,
      `---`,
      transcript,
      `---`,
      ``,
      `## 纪要写作要求`,
      ``,
      `必须包含以下章节（缺一不可）：`,
      ``,
      `### 1. 核心结论`,
      `会议达成的所有共识，每条都写明完整逻辑链与依据。`,
      ``,
      `### 2. 各方观点完整摘要`,
      `按参与者分块，每位的主要发言、论据、立场。`,
      ``,
      `### 3. 争议点与未决问题`,
      `未达成一致的议题，各方分歧所在。`,
      ``,
      `### 4. 待办事项与下一步`,
      `具体行动、负责方、约束条件。`,
      ``,
      `### 5. 关键技术决策（如有）`,
      `涉及的技术方案、参数、边界、依赖项。`,
      ``,
      `## 输出约束`,
      `- 不要为简洁牺牲信息密度`,
      `- 直接输出 Markdown 纪要正文，不要用 <think> / <answer> 标签包裹`,
      `- 不要在开头说"以下是纪要"之类的废话`,
    ].join('\n'),
  };

  const msgs: ContextMessage[] = [system, { role: 'user', content: '请按上述要求生成会议纪要。' }];

  const onChunk = onEvent
    ? (chunk: string) => { onEvent({ type: 'chair-token', chunk }); }
    : undefined;

  try {
    const r = await callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal });
    onEvent?.({ type: 'minutes-done', content: r.content });
    return { minutes: r.content, transcript };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { minutes: '[会议纪要生成被中止]', transcript };
    }
    const errMsg = `[纪要生成失败] ${(e as Error).message}`;
    onEvent?.({ type: 'minutes-done', content: errMsg });
    return { minutes: errMsg, transcript };
  }
}

// ── 辅助：构建会议中 Agent 的 system prompt ──────────────────────

/** 会议室工作环境段：身份 + 名字 + 消息来源识别（前缀规律） */
function buildMeetingEnvironmentSection(selfLabel: string, meetingLabel: string, agentName: string): string {
  return [
    `# 你的工作环境`,
    ``,
    `你运行在「信风」多 Agent 协作程序中，此刻正参加一场人类组织的圆桌会议。`,
    ``,
    `你当前的身份：${selfLabel}（会议室「${meetingLabel}」的参与者）`,
    `你的名字：${agentName}`,
    ``,
    `## 谁在跟你说话`,
    `- 系统信息（以「[系统信息：...]」开头）—— 会议流程消息、其他节点的联络消息`,
    `- 人类消息（无系统标注）—— 会议的组织者和决策者，优先级最高`,
  ].join('\n');
}

function buildMeetingAgentPrompt(
  agent: LoadedAgent,
  participants: string[],
  session: MeetingSessionData,
  toolDefs: import('../../shared/tool-defs-loader').ToolDef[],
  workspace: string,
  selfLabel: string,
  meetingLabel: string,
  dataDir: string,
  contactTargets?: Array<{ label: string; role: string }>,
  native?: boolean,
): string {
  const sections: string[] = [];

  // §0 元认知（meeting-meta.md，最前注入）
  const meta = loadMeetingMeta();
  if (meta) sections.push(meta);

  // §1 角色定义（Agent 实体自带的 rolePrompt）
  if (agent.rolePrompt) sections.push(`# 角色\n\n${agent.rolePrompt}`);

  // §2 会议室工作环境（身份 + 名字 + 消息来源识别）
  sections.push(buildMeetingEnvironmentSection(selfLabel, meetingLabel, agent.name));

  // §3 工具协议
  // - text 模式：完整文本协议（教 <action>/<answer> 格式 + 工具列表）
  // - native 模式：跳过文本协议教学，schema 由 API tools 参数注入；工具列表由 §5 简述
  if (toolDefs.length > 0 && !native) {
    sections.push(buildSystemPrompt(toolDefs));
  }

  // §4 「基地 + 沙箱」段
  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, workspace);
  sections.push(buildSandboxSection({
    workspaceAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '会议室共享工作区',
  }));

  // §5 会议场景说明
  const otherParticipants = participants.filter(p => p !== selfLabel);
  const finalReplyDesc = native
    ? `- 工具调用过程不会展示给其他参与者，只有最终回答会被公开`
    : `- 工具调用过程不会展示给其他参与者，只有最终 <answer> 内容会被公开\n- 用 <answer>你的发言</answer> 包裹最终回复`;

  const contactSection: string[] = [
    `## 联络节点（contact）`,
    ``,
    ...(contactTargets && contactTargets.length > 0 ? [
      `可联络的节点：`,
      ...contactTargets.map(t => `  - ${t.label}：${t.role}`),
      ``,
    ] : []),
  ];

  if (native) {
    contactSection.push(
      `调用 \`contact\` 工具向目标节点发送消息，对方处理后返回回复。`,
      `- 必须真正调用工具才会触发，仅在文字里说"我联络了xxx"不会有任何动作`,
      `- 对方处理可能涉及工具调用，需耐心等待`,
      ``,
    );
  } else {
    contactSection.push(
      `### contact`,
      `  描述: 向目标节点发送消息，对方处理后返回回复。`,
      `  参数:`,
      `    target: string [必填] — 目标节点名称（可选值：${contactTargets && contactTargets.length > 0 ? contactTargets.map(t => t.label).join('、') : '（无可联络节点）'}）`,
      `    message: string [必填] — 你要传达的内容`,
      `  - 必须真正调用工具才会触发，仅在文字里说"我联络了xxx"不会有任何动作`,
      `  - 对方处理可能涉及工具调用，需耐心等待`,
      `  调用示例:`,
      `  <action tool="contact">{"target":"节点名称","message":"你要传达的具体内容"}</action>`,
      ``,
    );
  }

  sections.push([
    `# 当前场景`,
    ``,
    `你正在参加一场圆桌会议。`,
    `- 话题：${session.topic}`,
    `- 其他参与者：${otherParticipants.length > 0 ? otherParticipants.join('、') : '（仅你一人）'}`,
    ``,
    `## 这是讨论场，不是执行工位`,
    `- 默认只发言、不动手——把观点说清楚、把问题想透彻，才是你在这里的价值。`,
    `- 涉及对会议室之外产生真实影响的操作（写文件、运行命令、修改数据、或用 contact 联络节点），必须等人类明确表达让你执行的意图后才可发起，未经准许绝不擅自行动。`,
    `- 确需查阅资料（读取、搜索）支撑观点时可以自便，但能凭已知讨论就别动工具。`,
    ``,
    `## 发言规范（人类在听，请替人类着想）`,
    `- 简短，一次说清一个观点，不要长篇大论——你说得越长，人类越难抓住重点。`,
    `- 不要重复其他参与者已经说过的内容。`,
    `- 回应某人观点时，明确点名是谁的观点。`,
    finalReplyDesc,
    ``,
    ...contactSection,
    `## 会议结束后`,
    `会议结束时，会长会生成完整纪要。`,
    `纪要 + 完整对话记录会自动注入你的工作上下文，供你后续工作流任务参考。`,
    `所以你在会议中的发言很重要——它们会被记录，并影响你后续的工作。`,
  ].join('\n'));

  return sections.join('\n\n---\n\n');
}

