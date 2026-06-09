/**
 * 潮汐 — 推送目标解析（读哪个会话 / 写哪里 / 归档）
 *
 * 三模式：
 *   new        → 每次新建潮汐会话，空历史
 *   accumulate → 绑定潮汐会话滚动，rolling-window（N=1 无上下文特例）
 *   designated → 写入季风会话，裸 append 无 N
 */

import type { ContextMessage } from '../../engine/shared/types';
import type { TideTask } from './types';
import {
  readTideSession, readSeasonSession,
  writeTideSession, writeSeasonSession,
  archiveIfNeeded,
  type TideSession, type TideMessage,
} from './session-store';

function msgId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newSessionId(task: TideTask, suffix: string): string {
  return `${task.agentId}-tide-${task.id.slice(0, 8)}-${suffix}`;
}

/** 会话 messages → ContextMessage[]（剔除 system，只留对话轮） */
function toContext(msgs: TideMessage[]): ContextMessage[] {
  return msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export interface ResolvedTarget {
  sessionId: string;
  history: ContextMessage[]; // 不含 system、不含本轮
  existing: TideSession | null;
}

/** 加载阶段：决定 sessionId + 历史上下文 */
export async function resolveTarget(
  dataDir: string, task: TideTask,
): Promise<ResolvedTarget> {
  // designated：读季风会话（已删则降级重建）
  if (task.pushMode === 'designated') {
    const sid = task.targetSessionId || newSessionId(task, 'designated');
    const existing = task.targetSessionId
      ? await readSeasonSession(dataDir, task.agentId, sid)
      : null;
    return { sessionId: sid, history: existing ? toContext(existing.messages) : [], existing };
  }

  // accumulate（含旧 'new' 任务，统一降级到这里）
  const sid = task.targetSessionId || newSessionId(task, 'acc');
  const existing = task.targetSessionId
    ? await readTideSession(dataDir, task.agentId, sid)
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

/**
 * 保存阶段：把本轮 user+assistant 写入目标会话，按模式分流。
 * 返回需要回写 task 的字段。
 */
export async function saveTurn(
  dataDir: string, task: TideTask, resolved: ResolvedTarget,
  agentName: string, model: string, rolePrompt: string,
  userText: string, answer: string,
  intermediate: TideMessage[] = [],
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
    base.messages.push(userMsg, botMsg);
    base.updatedAt = now;
    await writeSeasonSession(dataDir, base);
    return { targetSessionId: resolved.sessionId };
  }

  // accumulate（N=1 或 N≥2 统一路径）：追加本轮 → 归档检查
  base.messages.push(...turnMsgs);
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
