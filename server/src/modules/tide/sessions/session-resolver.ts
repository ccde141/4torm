/**
 * 潮汐 — 推送目标解析（读哪个会话 / 写哪里 / 归档）
 *
 * 三模式：
 *   new        → 每次新建潮汐会话，空历史
 *   accumulate → 绑定潮汐会话滚动，rolling-window（N=1 无上下文特例）
 *   designated → 写入季风会话，裸 append 无 N
 */

import type { ContextMessage } from '../../../engine/shared/types.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { TideTask } from '../domain/task.js';
import { SeasonSessionPort } from './season-session-port.js';
import { activeTideContext } from './active-context.js';
import { advanceTideUsage, mergeTideUsage, type TideUsageProgress } from '../domain/token-usage.js';
import { migrateOldTideSessions } from './session-migration.js';
import {
  readTideSession, readSeasonSession,
  writeTideSession, appendSeasonTurn,
  archiveIfNeeded,
  type TideSession, type TideMessage,
} from './session-store.js';

function msgId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newSessionId(task: TideTask, suffix: string): string {
  return `${task.agentId}-tide-${task.id}-${suffix}`;
}

export function resolveTargetSessionId(task: TideTask): string {
  const suffix = task.pushMode === 'designated' ? 'designated' : 'acc';
  return task.targetSessionId || newSessionId(task, suffix);
}

/** 原始会话 → 活跃模型投影（保留已提交摘要，不重新带入归档原文）。 */
const toContext = activeTideContext;

export interface ResolvedTarget {
  sessionId: string;
  history: ContextMessage[]; // 不含静态角色提示词、不含本轮，可能包含压缩摘要。
  existing: TideSession | null;
  /** Number of this run's calls already written to an accumulate session. */
  liveUsageCalls?: number;
  compactedContext?: ContextMessage[];
}

/** 加载阶段：决定 sessionId + 历史上下文 */
export async function resolveTarget(
  dataDir: string, task: TideTask,
): Promise<ResolvedTarget> {
  // designated：读季风会话（已删则降级重建）
  if (task.pushMode === 'designated') {
    const sid = resolveTargetSessionId(task);
    const existing = task.targetSessionId
      ? await readSeasonSession(dataDir, task.agentId, sid)
      : null;
    if (!existing) throw new Error('指定季风会话不存在');
    return { sessionId: sid, history: await new SeasonSessionPort(dataDir).activeContext(existing), existing };
  }

  // accumulate（含旧 'new' 任务，统一降级到这里）
  await migrateOldTideSessions(dataDir, task.agentId, task.id, task.name);
  const sid = resolveTargetSessionId(task);
  const existing = task.targetSessionId
    ? await readTideSession(dataDir, task.agentId, sid, task)
    : null;
  // N=1 无上下文：每轮独立，走归档清空逻辑（不带历史）
  const history = (task.windowN <= 1 || !existing) ? [] : toContext(existing.messages);
  return { sessionId: sid, history, existing };
}

export interface SaveResult {
  // 需要回写到 task 的字段变更
  targetSessionId: string;
  roundSeq?: number;
  archiveBatch?: number;
}

export async function recordTargetUsage(
  dataDir: string, task: TideTask, resolved: ResolvedTarget,
  usage: TokenUsage | null,
): Promise<boolean> {
  if (task.pushMode !== 'designated') {
    if (!resolved.existing) return false;
    const next: TideSession = { ...resolved.existing,
      usage: advanceTideUsage(resolved.existing.usage, usage),
      updatedAt: new Date().toISOString() };
    next.tokenUsage = next.usage?.latest;
    await writeTideSession(dataDir, next, task.id, task.name);
    resolved.existing = next;
    resolved.liveUsageCalls = (resolved.liveUsageCalls ?? 0) + 1;
    return true;
  }
  const revision = resolved.existing?.revision;
  if (revision === undefined) throw new Error('指定季风会话缺少版本');
  resolved.existing = await new SeasonSessionPort(dataDir).recordUsage(
    task.agentId, resolved.sessionId, revision, usage);
  return true;
}

/**
 * 保存阶段：把本轮 user+assistant 写入目标会话，按模式分流。
 * 返回需要回写 task 的字段。
 */
export async function saveTurn(
  dataDir: string, task: TideTask, resolved: ResolvedTarget,
  agentName: string, model: string, rolePrompt: string,
  userText: string, answer: string,
  intermediate: TideMessage[] = [],
  usage?: TideUsageProgress,
): Promise<SaveResult> {
  const now = new Date().toISOString();
  const userMsg: TideMessage = { id: msgId(), role: 'user', content: userText, timestamp: now };
  const botMsg: TideMessage = { id: msgId(), role: 'assistant', content: answer, timestamp: now };
  // 完整消息链：user → [tool-call, tool-result, ...] → assistant
  const turnMsgs: TideMessage[] = [userMsg, ...intermediate, botMsg];

  const base: TideSession = resolved.existing ?? {
    id: resolved.sessionId, agentId: task.agentId, agentName,
    title: `🌊 ${task.name} ${now.slice(0, 10)}`,
    messages: [], model, systemPrompt: rolePrompt,
    createdAt: now, updatedAt: now,
  };

  // designated：裸 append 写季风（仅 user+assistant，不污染季风会话格式）
  if (task.pushMode === 'designated') {
    if (resolved.existing?.revision === undefined) throw new Error('指定季风会话缺少版本');
    await appendSeasonTurn(dataDir, task.agentId, resolved.sessionId,
      resolved.existing.revision, userMsg, botMsg, resolved.compactedContext);
    return { targetSessionId: resolved.sessionId };
  }

  // accumulate（N=1 或 N≥2 统一路径）：追加本轮 → 归档检查
  if (resolved.liveUsageCalls && usage?.calls !== resolved.liveUsageCalls) {
    throw new Error('潮汐实时用量与最终运行记录不一致');
  }
  base.messages.push(...turnMsgs);
  if (resolved.compactedContext) base.messages.push({ id: msgId(), role: 'system',
    content: '[历史压缩记录]', type: 'compact-marker', contextExact: true,
    nativeContext: resolved.compactedContext, timestamp: now });
  base.usage = resolved.liveUsageCalls ? base.usage : mergeTideUsage(base.usage, usage);
  base.tokenUsage = base.usage?.latest;
  base.updatedAt = now;
  await writeTideSession(dataDir, base, task.id, task.name);

  // 兜底：会话被外部删除（existing 为 null 但 task 有历史轮次）→ 复位 roundSeq，
  // archiveBatch 接续防止 bak 文件名冲突
  const sessionWasRecreated = !resolved.existing && (task.roundSeq ?? 0) > 0;
  const roundSeq = sessionWasRecreated ? 1 : (task.roundSeq ?? 0) + 1;
  const batch = task.archiveBatch ?? 0;
  const result = await archiveIfNeeded(dataDir, base, roundSeq, task.windowN, batch, task.id, task.name);
  return {
    targetSessionId: resolved.sessionId,
    roundSeq: result.newRoundSeq,
    archiveBatch: result.newBatch,
  };
}
