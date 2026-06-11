/**
 * 对流上下文压缩器（独立副本，不依赖信风）
 *
 * 设计：
 * - 阈值 200K promptTokens → 触发会长压缩
 * - 按 speak 周期分割（人类发言开启新周期）
 * - 压缩前 150K 区间 → 25-30K 摘要，保留最近 50K 原文不动
 * - 会长用自身 model 做摘要（主持人整理笔记，质量更高）
 * - 归档原文到 workspace/bak/{seq}.json
 * - 失败策略：重试一次 → 禁用
 */

import type { ContextMessage } from '../shared/types';
import { callLLM } from '../shared/llm-bridge';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 常量 ──────────────────────────────────────────────────────────

/** 对流压缩触发阈值（promptTokens） */
export const CONVECTION_COMPACT_THRESHOLD = 200_000;

// ── 类型 ──────────────────────────────────────────────────────────

export interface ConvectionCompactState {
  /** 压缩是否已被禁用（两次失败后） */
  disabled: boolean;
  /** 当前已归档序号 */
  archiveSeq: number;
}

export interface ConvectionMessage {
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }>;
}

export interface ConvectionCompactOpts {
  /** 数据目录 */
  dataDir: string;
  /** 会长 model key（用于摘要调用） */
  chairModel: string;
  /** 归档目录（workspace/bak/） */
  archiveDir: string;
  /** 参与者 label 列表 */
  participants: string[];
  /** 事件回调 */
  onEvent?: (ev: ConvectionCompactEvent) => void;
}

export type ConvectionCompactEvent =
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedCycles: number; summaryLength: number }
  | { type: 'compact-warn'; message: string };

// ── 核心逻辑 ──────────────────────────────────────────────────────

/**
 * 检测是否需要压缩，如果需要则执行。
 * 返回 true = 进行了压缩。
 *
 * 原地修改 publicMessages 数组。
 */
export async function compactConvectionIfNeeded(
  publicMessages: ConvectionMessage[],
  lastPromptTokens: number | undefined,
  state: ConvectionCompactState,
  opts: ConvectionCompactOpts,
): Promise<boolean> {
  if (state.disabled) return false;
  if (!lastPromptTokens || lastPromptTokens < CONVECTION_COMPACT_THRESHOLD) return false;

  // 按 speak 周期分割
  const cycles = splitIntoCycles(publicMessages);
  // 至少 3 个周期才能压缩（保留最后若干周期）
  if (cycles.length < 3) return false;

  opts.onEvent?.({ type: 'compact-start' });

  // 估算保留量：保留最近约 50K tokens 的周期
  // 简单策略：保留最后 2 个周期（通常足够），如果周期很短则多保留
  const keepCount = Math.min(Math.max(2, Math.floor(cycles.length * 0.25)), cycles.length - 1);
  const toCompactCycles = cycles.slice(0, cycles.length - keepCount);
  const keepCycles = cycles.slice(cycles.length - keepCount);

  if (toCompactCycles.length === 0) return false;

  // 归档到磁盘
  const toArchive = toCompactCycles.flat();
  state.archiveSeq++;
  const archiveFileName = `${String(state.archiveSeq).padStart(3, '0')}.json`;

  try {
    await fs.mkdir(opts.archiveDir, { recursive: true });
    await fs.writeFile(
      path.join(opts.archiveDir, archiveFileName),
      JSON.stringify(toArchive, null, 2),
    );
  } catch { /* 归档写入失败不阻塞 */ }

  // 会长做摘要
  const summaryPrompt = buildConvectionSummaryPrompt(opts.participants);
  const summaryMessages: ContextMessage[] = [
    { role: 'system', content: summaryPrompt },
    { role: 'user', content: formatForSummary(toArchive) },
  ];

  let summary: string;
  try {
    summary = await callSummaryLLM(summaryMessages, opts);
  } catch (firstErr) {
    // 重试一次
    try {
      summary = await callSummaryLLM(summaryMessages, opts);
    } catch {
      state.disabled = true;
      opts.onEvent?.({ type: 'compact-warn', message: `对流压缩失败已禁用：${(firstErr as Error).message}` });
      return false;
    }
  }

  // 重组：摘要条目 + 保留周期
  const summaryEntry: ConvectionMessage = {
    speaker: '系统',
    content: `[对话历史摘要]\n\n${summary}`,
    timestamp: Date.now(),
  };

  publicMessages.length = 0;
  publicMessages.push(summaryEntry, ...keepCycles.flat());

  opts.onEvent?.({
    type: 'compact-done',
    archivedCycles: toCompactCycles.length,
    summaryLength: summary.length,
  });

  return true;
}

// ── 辅助 ──────────────────────────────────────────────────────────

/** 按 speak 周期分割：人类发言开启新周期 */
function splitIntoCycles(messages: ConvectionMessage[]): ConvectionMessage[][] {
  const cycles: ConvectionMessage[][] = [];
  let current: ConvectionMessage[] = [];

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

function buildConvectionSummaryPrompt(participants: string[]): string {
  const participantSections = participants
    .map(p => `### ${p}\n- 发言要点：\n- 立场/观点：\n- 当前状态：`)
    .join('\n\n');

  return `你是一位对话记录压缩专家。下面是一段多人讨论的历史记录。

请严格按以下格式输出压缩摘要：

## 各参与者记录

${participantSections}

## 议题推进

- 已达成共识：
- 仍有分歧：
- 待讨论：

## 关键决策与数据

（列出所有已达成的决策、重要数据点、引用的文件路径等）

要求：
- 每个参与者块独立完整
- "发言要点"只保留实质性观点和结论，压缩重复论述
- "立场/观点"用一句话概括该参与者在各议题上的态度
- 摘要应足够详细，让后续对话能无缝接续
- 直接输出摘要内容，不要加前缀说明`;
}

function formatForSummary(messages: ConvectionMessage[]): string {
  return messages.map(m => `[${m.speaker}] ${m.content}`).join('\n\n');
}

async function callSummaryLLM(
  messages: ContextMessage[],
  opts: ConvectionCompactOpts,
): Promise<string> {
  const result = await callLLM({
    dataDir: opts.dataDir,
    fullModelKey: opts.chairModel,
    messages,
    options: { temperature: 0.3 },
  });
  if (!result.content.trim()) throw new Error('压缩摘要 LLM 返回空内容');
  return result.content;
}
