/**
 * 信风上下文压缩器
 *
 * 职责：
 * - 检测 token 阈值 → 触发压缩
 * - 按轮次粒度归档旧消息到磁盘
 * - 调 LLM 生成全量摘要替换旧消息
 * - 失败策略：重试一次 → 仍失败则禁用压缩 + 推警告
 *
 * 设计要点：
 * - 压缩是独立 LLM 调用（只传待压缩消息 + 摘要 prompt）
 * - 摘要目标 20K-40K tokens 区间
 * - Agent 节点阈值 200K，会议室 300K
 * - 保留最近两轮不动
 */

import type { ContextMessage } from '../../shared/types';
import { callLLM } from '../../shared/llm-bridge';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 常量 ──────────────────────────────────────────────────────────

/** Agent 节点压缩触发阈值（promptTokens） */
export const AGENT_COMPACT_THRESHOLD = 200_000;
/** 会议室压缩触发阈值（promptTokens） */
export const MEETING_COMPACT_THRESHOLD = 300_000;

// ── 类型 ──────────────────────────────────────────────────────────

export interface CompactorOpts {
  /** LLM 数据目录（加载 providers） */
  dataDir: string;
  /** 用于摘要的模型 key */
  model: string;
  /** 归档目录（output/bak/agent_{name}/ 或 output/bak/meeting_{name}/） */
  archiveDir: string;
  /** 阈值（promptTokens） */
  threshold: number;
  /** 压缩完成/警告回调 */
  onEvent?: (ev: CompactEvent) => void;
}

export type CompactEvent =
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedRounds: number; summaryLength: number }
  | { type: 'compact-warn'; message: string };

export interface CompactState {
  /** 压缩是否已被禁用（两次失败后） */
  disabled: boolean;
  /** 当前已归档的轮次序号 */
  archiveSeq: number;
}

// ── 轮次分割 ──────────────────────────────────────────────────────

/**
 * 将 messages 按轮次分割。
 * 一轮 = 一个 user 消息 + 紧跟的所有 assistant/system 消息（直到下一个 user）。
 * 第一条 system（prompt）单独算第 0 轮（不参与压缩）。
 */
export function splitIntoRounds(messages: ContextMessage[]): ContextMessage[][] {
  const rounds: ContextMessage[][] = [];
  let current: ContextMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // 第一条 system prompt 单独成组
    if (i === 0 && msg.role === 'system') {
      rounds.push([msg]);
      continue;
    }
    // user 消息开启新轮次
    if (msg.role === 'user' && current.length > 0) {
      rounds.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) rounds.push(current);

  return rounds;
}

// ── 摘要 prompt ──────────────────────────────────────────────────

const SUMMARY_PROMPT = `你是一个专业的上下文压缩助手。下面是一段 AI Agent 的工作历史记录。

请生成一份详尽的工作摘要，要求：
1. 保留所有关键决策、结论、数据点、文件路径、代码片段引用
2. 保留所有已完成的任务及其结果
3. 保留所有未完成的任务和待办事项
4. 压缩冗余的思考过程和重复的工具调用中间步骤
5. 用结构化格式（标题 + 要点）组织
6. 摘要应足够详细，让 Agent 在只看摘要的情况下能无缝接续工作

直接输出摘要内容，不要加任何前缀说明。`;

// ── 核心逻辑 ──────────────────────────────────────────────────────

/**
 * 检查是否需要压缩，如果需要则执行。
 * 返回 true = 进行了压缩，false = 未触发/已禁用。
 *
 * 注意：此函数会**原地修改** messages 数组。
 */
export async function compactIfNeeded(
  messages: ContextMessage[],
  lastPromptTokens: number | undefined,
  state: CompactState,
  opts: CompactorOpts,
): Promise<boolean> {
  if (state.disabled) return false;
  if (!lastPromptTokens || lastPromptTokens < opts.threshold) return false;

  const rounds = splitIntoRounds(messages);
  // 至少需要：system prompt(1) + 可压缩轮次(1+) + 保留轮次(2)
  // rounds[0] = system prompt, rounds[1..n-2] = 可压缩, rounds[n-1..n] = 保留
  if (rounds.length < 4) return false; // 不够压

  opts.onEvent?.({ type: 'compact-start' });

  // 分割：保留最后两轮 + system prompt
  const systemRound = rounds[0];
  const keepCount = 2;
  const toCompactRounds = rounds.slice(1, rounds.length - keepCount);
  const keepRounds = rounds.slice(rounds.length - keepCount);

  if (toCompactRounds.length === 0) return false;

  // 归档到磁盘
  const toArchive = toCompactRounds.flat();
  state.archiveSeq++;
  const archiveFileName = `round-${String(state.archiveSeq).padStart(3, '0')}.json`;

  try {
    await fs.mkdir(opts.archiveDir, { recursive: true });
    await fs.writeFile(
      path.join(opts.archiveDir, archiveFileName),
      JSON.stringify(toArchive, null, 2),
    );
  } catch { /* 归档写入失败不阻塞 */ }

  // 调 LLM 生成摘要（独立调用，只传待压缩消息）
  const summaryMessages: ContextMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: formatMessagesForSummary(toArchive) },
  ];

  let summary: string;
  try {
    summary = await callSummaryLLM(summaryMessages, opts);
  } catch (firstErr) {
    // 重试一次
    try {
      summary = await callSummaryLLM(summaryMessages, opts);
    } catch {
      // 两次失败 → 禁用压缩
      state.disabled = true;
      opts.onEvent?.({ type: 'compact-warn', message: `压缩失败已禁用：${(firstErr as Error).message}` });
      return false;
    }
  }

  // 重组 messages：system + 摘要消息 + 保留轮次
  const summaryMsg: ContextMessage = {
    role: 'user',
    content: `[历史摘要 — 以下是截至目前的工作记录压缩版]\n\n${summary}`,
  };

  // 原地修改 messages 数组
  messages.length = 0;
  messages.push(...systemRound, summaryMsg, ...keepRounds.flat());

  opts.onEvent?.({
    type: 'compact-done',
    archivedRounds: toCompactRounds.length,
    summaryLength: summary.length,
  });

  return true;
}

// ── 辅助 ──────────────────────────────────────────────────────────

function formatMessagesForSummary(messages: ContextMessage[]): string {
  return messages.map(m => {
    const label = m.role === 'user' ? '[用户/系统输入]'
      : m.role === 'assistant' ? '[Agent 输出]'
      : '[系统消息]';
    return `${label}\n${m.content}`;
  }).join('\n\n---\n\n');
}

async function callSummaryLLM(
  messages: ContextMessage[],
  opts: CompactorOpts,
): Promise<string> {
  const result = await callLLM({
    dataDir: opts.dataDir,
    fullModelKey: opts.model,
    messages,
    options: { temperature: 0.3 },
  });
  if (!result.content.trim()) throw new Error('摘要 LLM 返回空内容');
  return result.content;
}

// ── 会议室压缩 ────────────────────────────────────────────────────

export interface MeetingMessage {
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }>;
}

const MEETING_SUMMARY_PROMPT = `你是一位会议记录压缩专家。下面是一段多人会议的历史讨论记录。

请生成一份详尽的会议摘要，要求：
1. 保留所有关键观点、决策、结论、数据
2. 标注每个观点的发言者
3. 保留未解决的争议和待讨论事项
4. 压缩重复论述和闲聊内容
5. 用结构化格式（议题 + 各方观点 + 结论）组织
6. 摘要应足够详细，让重新加入会议的人能快速了解全部讨论进展

直接输出摘要内容，不要加任何前缀说明。`;

/**
 * 会议室压缩：按 speak 周期为粒度。
 * 一次 speak 周期 = 人类发言 + 所有 Agent 回复。
 *
 * 返回 true = 进行了压缩。
 */
export async function compactMeetingIfNeeded(
  publicMessages: MeetingMessage[],
  lastPromptTokens: number | undefined,
  state: CompactState,
  opts: CompactorOpts,
): Promise<boolean> {
  if (state.disabled) return false;
  if (!lastPromptTokens || lastPromptTokens < opts.threshold) return false;

  // 按 speak 周期分割：每个"人类"发言开启一个新周期
  const cycles = splitMeetingIntoCycles(publicMessages);
  // 至少需要 3 个周期才能压缩（保留最后 2 个）
  if (cycles.length < 3) return false;

  opts.onEvent?.({ type: 'compact-start' });

  const keepCount = 2;
  const toCompactCycles = cycles.slice(0, cycles.length - keepCount);
  const keepCycles = cycles.slice(cycles.length - keepCount);

  if (toCompactCycles.length === 0) return false;

  // 归档到磁盘
  const toArchive = toCompactCycles.flat();
  state.archiveSeq++;
  const archiveFileName = `round-${String(state.archiveSeq).padStart(3, '0')}.json`;

  try {
    await fs.mkdir(opts.archiveDir, { recursive: true });
    await fs.writeFile(
      path.join(opts.archiveDir, archiveFileName),
      JSON.stringify(toArchive, null, 2),
    );
  } catch { /* 归档写入失败不阻塞 */ }

  // 会长做摘要
  const summaryMessages: ContextMessage[] = [
    { role: 'system', content: MEETING_SUMMARY_PROMPT },
    { role: 'user', content: formatMeetingForSummary(toArchive) },
  ];

  let summary: string;
  try {
    summary = await callSummaryLLM(summaryMessages, opts);
  } catch (firstErr) {
    try {
      summary = await callSummaryLLM(summaryMessages, opts);
    } catch {
      state.disabled = true;
      opts.onEvent?.({ type: 'compact-warn', message: `会议压缩失败已禁用：${(firstErr as Error).message}` });
      return false;
    }
  }

  // 重组 publicMessages：摘要消息 + 保留周期
  const summaryEntry: MeetingMessage = {
    speaker: '系统',
    content: `[会议历史摘要]\n\n${summary}`,
    timestamp: Date.now(),
  };

  publicMessages.length = 0;
  publicMessages.push(summaryEntry, ...keepCycles.flat());

  opts.onEvent?.({
    type: 'compact-done',
    archivedRounds: toCompactCycles.length,
    summaryLength: summary.length,
  });

  return true;
}

/**
 * 将 publicMessages 按 speak 周期分割。
 * 一个周期 = 人类发言开始 → 下一个人类发言之前的所有消息。
 */
function splitMeetingIntoCycles(messages: MeetingMessage[]): MeetingMessage[][] {
  const cycles: MeetingMessage[][] = [];
  let current: MeetingMessage[] = [];

  for (const msg of messages) {
    if (msg.speaker === '人类' && current.length > 0) {
      cycles.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) cycles.push(current);

  return cycles;
}

function formatMeetingForSummary(messages: MeetingMessage[]): string {
  return messages.map(m => `[${m.speaker}] ${m.content}`).join('\n\n');
}
