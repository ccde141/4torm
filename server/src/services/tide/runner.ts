/**
 * 潮汐 — TideRunner（核心执行器）
 *
 * 职责：接收 TideTask，调 SessionRunner 完成一次对话，
 * 保存会话到 agents/{id}/sessions/，保存运行记录到 tide/runs/。
 *
 * 与季风手动聊天唯一的区别：消息由系统而非用户输入。
 */

import path from 'node:path';
import { SessionRunner, type ConversationEvent, type SessionRunnerOpts } from '../../engine/conversation/session-runner';
import { loadAgent } from '../../engine/shared/agent-loader';
import { resolveNativeMode } from '../../engine/shared/llm-bridge';
import { buildConversationSystemPrompt } from '../../engine/conversation/prompt-builder';
import { tryAcquireSessionLease } from '../../engine/conversation/session-lease.js';
import { loadAgentToolDefs } from '../../engine/shared/tool-defs-loader';
import type { ContextMessage } from '../../engine/shared/types';
import type { TideTask, TideRunRecord } from './types';
import type { TideMessage } from './session-store';
import { saveRunRecord, upsertTask, getTask } from './store';
import { parseInterval } from './schedule-parser';
import { resolveTarget, resolveTargetSessionId, saveTurn } from './session-resolver';
import { SELF_LOOP_INSTRUCTION, extractNextPrompt } from './self-loop';
import { withAgentActivity } from '../../engine/shared/agent-activity.js';

/** 10 分钟硬超时 */
const TIMEOUT_MS = 10 * 60 * 1000;

/** 运行单次潮汐任务。designated 模式与目标季风会话互斥。 */
export async function runTideTask(dataDir: string, task: TideTask, isManual = false): Promise<TideRunRecord> {
  const run = () => withAgentActivity(
    task.agentId,
    'tide',
    () => runWithFailureBoundary(dataDir, task, isManual),
  );
  if (task.pushMode !== 'designated') return run();

  const sessionId = resolveTargetSessionId(task);
  const release = tryAcquireSessionLease(task.agentId, sessionId);
  if (!release) {
    const timestamp = new Date().toISOString();
    return recordFailure(dataDir, task, {
      timestamp,
      startedAt: Date.now(),
      sessionId,
      error: `指定的季风会话正在执行中：${sessionId}`,
      toolCalls: [],
      turns: 0,
    }, false);
  }
  try {
    return await run();
  } finally {
    release();
  }
}

async function runWithFailureBoundary(
  dataDir: string, task: TideTask, isManual: boolean,
): Promise<TideRunRecord> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  try {
    return await executeTideTask(dataDir, task, isManual);
  } catch (error) {
    return recordFailure(dataDir, task, {
      timestamp,
      startedAt,
      sessionId: resolveTargetSessionId(task),
      error: error instanceof Error ? error.message : String(error),
      toolCalls: [],
      turns: 0,
    });
  }
}

interface FailureDetails {
  timestamp: string;
  startedAt: number;
  sessionId: string;
  error: string;
  toolCalls: TideRunRecord['toolCalls'];
  turns: number;
}

async function recordFailure(
  dataDir: string,
  task: TideTask,
  details: FailureDetails,
  countFailure = true,
): Promise<TideRunRecord> {
  const record: TideRunRecord = {
    taskId: task.id, timestamp: details.timestamp, status: 'error', sessionId: details.sessionId,
    answer: '', rawContent: '', toolCalls: details.toolCalls, turns: details.turns,
    durationMs: Date.now() - details.startedAt, error: details.error,
  };
  await saveRunRecord(dataDir, record);
  const fresh = await getTask(dataDir, task.id);
  if (!fresh) return record;
  fresh.lastRun = details.timestamp;
  fresh.nextRun = new Date(Date.now() + parseInterval(fresh.schedule)).toISOString();
  if (countFailure) fresh.consecutiveErrors = (fresh.consecutiveErrors ?? 0) + 1;
  if (countFailure && fresh.consecutiveErrors >= 3) {
    fresh.enabled = false;
    console.error(`[tide] 任务 ${fresh.id} 连续失败 ${fresh.consecutiveErrors} 次，已自动暂停`);
  }
  await upsertTask(dataDir, fresh);
  return record;
}

async function executeTideTask(dataDir: string, task: TideTask, isManual: boolean): Promise<TideRunRecord> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const toolCalls: TideRunRecord['toolCalls'] = [];
  let turns = 0;

  const agent = await loadAgent(dataDir, task.agentId);
  if (!agent) {
    throw new Error(`Agent 不存在: ${task.agentId}`);
  }

  // 解析推送目标 + 历史上下文
  const resolved = await resolveTarget(dataDir, task);
  const sessionId = resolved.sessionId;

  // self-loop：拼接提示词（不再注入假工具）
  // native 模式：按 agent.model 决定，与季风/信风一致
  const nativeDecision = await resolveNativeMode(dataDir, agent.model);
  const opts: SessionRunnerOpts = {
    dataDir, agentId: agent.id, model: agent.model,
    temperature: agent.temperature, toolNames: agent.tools, toolMode: agent.toolMode, skillIds: agent.skills,
    workspace: agent.workspace, sandboxLevel: agent.sandboxLevel,
    native: nativeDecision.native,
  };

  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, agent.workspace);
  const toolDefs = await loadAgentToolDefs(dataDir, opts.toolNames, opts.skillIds, opts.toolMode);
  const rolePrompt = task.selfLoop ? agent.rolePrompt + SELF_LOOP_INSTRUCTION : agent.rolePrompt;
  const systemPrompt = await buildConversationSystemPrompt({
    rolePrompt, toolDefs,
    workspace: opts.workspace, workspaceAbs, projectDir,
    sandboxLevel: agent.sandboxLevel, skillIds: opts.skillIds,
    dataDir, agentId: agent.id, userMessage: task.prompt,
    native: nativeDecision.native,
  });

  // history（不含 system）+ 本轮 user
  // self-loop 模式：拼接 originalPrompt（锚点）+ 当前 prompt（本轮指令）
  const userMessage = task.selfLoop && task.originalPrompt && task.prompt !== task.originalPrompt
    ? `## 最高目标（每轮必须围绕此目标行动）\n${task.originalPrompt}\n\n## 本轮具体任务\n${task.prompt}`
    : task.prompt;

  const chatMessages: ContextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...resolved.history,
    { role: 'user', content: userMessage },
  ];

  const runner = new SessionRunner(opts);
  const timer = setTimeout(() => runner.abort(), TIMEOUT_MS);

  let answer: string; let rawContent: string;
  // 收集完整中间消息链（tool-call / tool-result），对齐季风体验
  const intermediate: TideMessage[] = [];
  let pendingArgs: Record<string, string> = {};

  try {
    const onEvent = (ev: ConversationEvent) => {
      if (ev.type === 'tool-call') {
        const { tool, args } = ev as { tool: string; args: Record<string, string> };
        pendingArgs = args;
        intermediate.push({
          id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'tool-call',
          content: JSON.stringify({ tool, args }),
          timestamp: new Date().toISOString(),
        });
      }
      if (ev.type === 'tool-result') {
        const { tool, result, ok } = ev as { tool: string; result: string; ok: boolean };
        toolCalls.push({ tool, args: pendingArgs, result });
        pendingArgs = {};
        turns += 1;
        intermediate.push({
          id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'tool-result',
          content: JSON.stringify({ tool, result, ok }),
          timestamp: new Date().toISOString(),
        });
      }
    };
    const result = await runner.chat(systemPrompt, chatMessages, onEvent);
    answer = result.content; rawContent = result.rawContent;
  } catch (e) {
    clearTimeout(timer);
    return recordFailure(dataDir, task, {
      timestamp, startedAt, sessionId, toolCalls, turns,
      error: (e as Error).message,
    });
  }
  clearTimeout(timer);

  // self-loop：从 answer 提取 [NEXT: ...] 标记，剥离后再存会话
  let nextPrompt: string | null = null;
  if (task.selfLoop) {
    const { next, cleaned } = extractNextPrompt(answer);
    nextPrompt = next;
    answer = cleaned;
  }

  // 保存会话（按模式分流 + 归档），含完整中间消息链
  const saveResult = await saveTurn(
    dataDir, task, resolved,
    agent.name, agent.model, agent.rolePrompt,
    userMessage, answer, intermediate,
  );

  const record: TideRunRecord = {
    taskId: task.id, timestamp, status: 'success', sessionId,
    answer, rawContent, toolCalls, turns,
    durationMs: Date.now() - startedAt,
  };
  await saveRunRecord(dataDir, record);

  // 统一回写 task（重读磁盘权威版本，防止删除/暂停被覆盖）
  const fresh = await getTask(dataDir, task.id);
  if (fresh) {
    // manual + 暂停任务：纯测试跑，不扣次不动时钟
    // manual + 活跃任务：等同"提前触发"，正常扣次 + 重置时钟
    const skipBookkeeping = isManual && !fresh.enabled;
    if (!skipBookkeeping) {
      if (fresh.repeatCount > 0) fresh.repeatCount -= 1;
      fresh.nextRun = new Date(Date.now() + parseInterval(fresh.schedule)).toISOString();
    }
    fresh.lastRun = timestamp;
    fresh.consecutiveErrors = 0; // 成功归零
    fresh.targetSessionId = saveResult.targetSessionId;
    if (saveResult.roundSeq !== undefined) fresh.roundSeq = saveResult.roundSeq;
    if (saveResult.archiveBatch !== undefined) fresh.archiveBatch = saveResult.archiveBatch;
    if (nextPrompt) fresh.prompt = nextPrompt;
    await upsertTask(dataDir, fresh);
  }

  return record;
}
