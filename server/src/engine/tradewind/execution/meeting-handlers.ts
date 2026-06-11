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
import { callLLM } from '../../shared/llm-bridge';
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
import { buildTradewindSystemPrompt } from './prompt-builder';
import { activeNodeRunners } from '../nodes/agent';

// ── 常量 ──────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = 3_600_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

// ── 事件类型 ──────────────────────────────────────────────────────

export type MeetingStreamEvent =
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; label: string; tool: string; result: string }
  | { type: 'heartbeat'; label: string; phase: string; elapsed: number }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }> }
  | { type: 'chair-token'; chunk: string }
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
): Promise<string> {
  const { execToolUnified } = await import('../../shared/exec-tool');
  return execToolUnified({ tool, args, agentId, workspaceDir: workspace, signal });
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
        reject(new Error('contact 超时（5 分钟未响应）'));
      }, 5 * 60 * 1000);

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
}

/**
 * 人类发言 → 参与 Agent 串行响应。
 * 每个 Agent 跑信风的 react-loop（带工具能力）。
 * 返回最后一个 Agent 的 promptTokens（用于压缩阈值判断）。
 */
export async function handleSpeak(opts: HandleSpeakOpts): Promise<number | undefined> {
  const { dataDir, workspace, session, humanMessage, signal, onEvent } = opts;

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
      session.streamingCurrent = { speaker: label, content: '' };
      onEvent?.({ type: 'agent-start', label });

      const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);

      // 构造 system prompt（参与者列表用 label）
      const participantLabels = session.participants.map(p => p.label);

      const systemText = buildMeetingAgentPrompt(agent, participantLabels, session, toolDefs, workspace, label, session.meetingLabel, dataDir);
      const history = formatPublicContext(session);
      const messages: ContextMessage[] = [
        { role: 'system', content: systemText },
        { role: 'user', content: history },
      ];

      // 构造 LLMCaller + ToolCaller
      const llm: LLMCaller = {
        async call(msgs, _opts, onChunk, sig) {
          return callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal: sig });
        },
      };
      const toolCaller: ToolCaller | undefined = toolDefs.length > 0 ? {
        async call(tool, args) {
          // contact 假工具：联络 agent 节点
          if (tool === 'contact') {
            return execMeetingContact(args, label, session.meetingLabel, signal);
          }
          try {
            const result = await execTool(tool, args, participant.agentId, workspace, signal);
            return result;
          } catch (e) {
            const err = `错误：${(e as Error).message}`;
            return err;
          }
        },
      } : undefined;

      // 跑 ReAct 循环
      const result = await runReActLoop({
        messages,
        llm,
        tools: toolCaller,
        maxTurns: 100,
        onEvent: (ev) => {
          if (ev.type === 'token') {
            if (session.streamingCurrent) session.streamingCurrent.content += ev.chunk;
            onEvent?.({ type: 'token', label, chunk: ev.chunk });
          }
          if (ev.type === 'heartbeat') onEvent?.({ type: 'heartbeat', label, phase: ev.phase, elapsed: ev.elapsed });
          if (ev.type === 'tool-call') onEvent?.({ type: 'tool-call', label, tool: ev.tool, args: ev.args });
          if (ev.type === 'tool-result') onEvent?.({ type: 'tool-result', label, tool: ev.tool, result: ev.result });
        },
        signal,
      });

      // 记录最后一个 participant 的 promptTokens
      if (result.lastPromptTokens) lastPromptTokens = result.lastPromptTokens;

      // abort 后 result.content 可能是 '[中止]' 或 '[错误]...'——用已流式积累的内容替代
      const aborted = signal?.aborted;
      const streamedContent = session.streamingCurrent?.content?.trim() || '';
      const finalContent = aborted
        ? (extractAnswer(streamedContent) ?? stripInternalTags(streamedContent).trim())
        : result.content;

      if (finalContent && !finalContent.startsWith('[中止]') && !finalContent.startsWith('[错误]')) {
        session.publicMessages.push({
          speaker: label,
          content: finalContent,
          timestamp: Date.now(),
          rawContent: result.rawContent || undefined,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        });
      }
      session.streamingCurrent = undefined;
      onEvent?.({ type: 'agent-done', label, content: finalContent, rawContent: result.rawContent, toolCalls: result.toolCalls });

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

  try {
    const r = await callLLM({ dataDir, fullModelKey: agent.model, messages: msgs, onChunk, signal });
    session.chairMessages.push({ role: 'assistant', content: r.content });
    onEvent?.({ type: 'chair-done', content: r.content });
  } catch (e) {
    onEvent?.({ type: 'error', message: (e as Error).message });
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

    try {
      let streamRaw = '';
      const r = await callLLM({
        dataDir,
        fullModelKey: agent.model,
        messages,
        onChunk: (chunk) => {
          streamRaw += chunk;
          // 实时更新占位消息的内容（含 <think> 等原始流，前端可看到全过程）
          const slot = session.publicMessages[placeholderIdx];
          if (slot) slot.content = streamRaw;
          onEvent?.({ type: 'token', label, chunk });
        },
        signal,
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
      onEvent?.({ type: 'agent-done', label, content: finalContent });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const errText = `（${label} 入会摘要生成失败：${(e as Error).message}）`;
      const slot = session.publicMessages[placeholderIdx];
      if (slot) {
        slot.content = errText;
        slot.streaming = false;
      }
      onEvent?.({ type: 'agent-done', label, content: errText });
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
  const historyText = history
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

/** 信风工作环境通用段（让 Agent 知道自己在多 Agent 协作系统中工作） */
function buildEnvironmentSection(nodeLabel: string): string {
  return [
    `# 你的工作环境`,
    ``,
    `你运行在「信风」多 Agent 协作工作流中。`,
    ``,
    `信风是一个多 Agent 协作系统，团队成员通过「信封」传递工作内容。`,
    `上游成员完成工作后，会把成果以信封的形式交给你；`,
    `你完成后，你的 <answer> 会自动打包成信封交给下游。`,
    ``,
    `人类作为负责人，可以随时与你对话、补充指令或调整方向。`,
    ``,
    `你当前的身份：${nodeLabel}`,
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
): string {
  const sections: string[] = [];

  // §1 角色定义（Agent 实体自带的 rolePrompt）
  if (agent.rolePrompt) sections.push(`# 角色\n\n${agent.rolePrompt}`);

  // §2 信风工作环境
  sections.push(buildEnvironmentSection(`${selfLabel}（会议室节点「${meetingLabel}」的参与者）`));

  // §3 完整工具协议（和普通会话一致，来自 shared/prompt）
  if (toolDefs.length > 0) {
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
  sections.push([
    `# 当前场景`,
    ``,
    `你正在参加一场圆桌会议。`,
    `- 话题：${session.topic}`,
    `- 其他参与者：${otherParticipants.length > 0 ? otherParticipants.join('、') : '（仅你一人）'}`,
    ``,
    `## 协作规范`,
    `- 基于对话上下文回应人类的发言，简洁、有观点、有建设性`,
    `- 不要重复其他参与者已经说过的内容`,
    `- 如果要回应某人的观点，明确指出是谁的观点`,
    `- 工具调用过程不会展示给其他参与者，只有最终 <answer> 内容会被公开`,
    `- 用 <answer>你的发言</answer> 包裹最终回复`,
    ``,
    `## 联络 Agent 节点`,
    ``,
    `你可以联络工作流中其他正在运行的 Agent 节点，让它们协助你或获取它们的工作成果。`,
    ``,
    `### contact`,
    `  描述: 联络工作流中的 Agent 节点。对方会处理你的消息并返回回复。`,
    `  参数:`,
    `    target: string [必填] — 目标节点名称`,
    `    message: string [必填] — 你要传达的内容（问题、请求、同步信息等）`,
    ``,
    `  注意：`,
    `  - 对方是工作流中实际执行任务的 Agent 节点，不是会议室内的参与者`,
    `  - 用于将会议讨论结论同步给执行者，或向执行者索取最新进展`,
    `  - 对方处理可能需要时间（涉及工具调用），请耐心等待`,
    ``,
    `## 会议结束后`,
    `会议结束时，会长会生成完整纪要。`,
    `纪要 + 完整对话记录会自动注入你的工作上下文，供你后续工作流任务参考。`,
    `所以你在会议中的发言很重要——它们会被记录，并影响你后续的工作。`,
  ].join('\n'));

  return sections.join('\n\n---\n\n');
}

