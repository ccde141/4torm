/**
 * 潮汐自动化工具 —— 季风 AI 为自己创建 / 修改 / 查看定时任务。
 *
 * 安全模型（极简版，无「草稿」概念）：
 *   - AI 建的任务一律 enabled:false（就是一个「停着的任务」，潮汐里本就有这个状态）。
 *   - AI 永远设不了 enabled：create 恒 false、update 保留原值不动。启用/暂停只在潮汐页由人操作。
 *   - AI 碰 tasks.json 只有这一条路（专用工具）；直接写盘被 _resolve.js 控制面保护挡下。
 *   - 无人值守（潮汐运行，无 sessionId）由 session-runner 拦下，不注入这些工具。
 *
 * 护栏（用户拍板，刻意宽松，因为启动权在人）：间隔下限 60s；repeatCount 允许 -1 永续、不封顶；
 * selfLoop 允许（潮汐页审阅时可见）；pushMode 仅 accumulate。
 */

import fs from 'node:fs/promises';
import { normalizeSandboxLevel } from '../../services/execution-context.js';
import path from 'node:path';
import { agentRegistryFile } from '../../services/data-paths.js';
import { loadTasks, getTask, upsertTask } from '../../services/tide/store';
import { parseInterval } from '../../services/tide/schedule-parser';
import type { TideTask } from '../../services/tide/types';

const MIN_INTERVAL_MS = 60_000; // AI 自建间隔下限（手动路由不受此限）
const WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file'];

/** 信息卡数据：全部由服务端按真实任务字段生成，不经 AI 转述。 */
export interface PendingAutomation {
  mode: 'created' | 'updated';
  taskId: string;
  name: string;
  schedule: string;
  repeatCount: number;
  perpetual: boolean;   // repeatCount === -1
  selfLoop: boolean;
  windowN: number;
  enabled: boolean;     // AI 建的恒 false；改的保留原值
  agentName: string;
  sandboxLevel: string;
  canWriteFiles: boolean; // 该 agent 是否持有写文件类工具（“只读不改”的事实依据）
  promptPreview: string;
}

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const parseBool = (v: unknown) => ['true', '1', 'yes'].includes(str(v).toLowerCase());
const fail = (msg: string) => ({ result: `操作失败：${msg}` });
const genId = () => `tide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 兼容 AI 的多种写法：{params:"{...}"} 包装 / 平铺。 */
function extract(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.params === 'string') {
    try { return { ...args, ...JSON.parse(args.params) }; } catch { /* 按平铺处理 */ }
  }
  return args;
}

function validateSchedule(schedule: string): string | null {
  let ms: number;
  try { ms = parseInterval(schedule); } catch (e) { return (e as Error).message; }
  if (ms < MIN_INTERVAL_MS) return '间隔不能小于 60 秒（every 1m 起）。';
  return null;
}
/** 返回解析后的数值，或错误字符串。 */
function parseRepeat(v: unknown): number | string {
  if (v == null || str(v) === '') return -1;
  const n = parseInt(str(v), 10);
  if (Number.isNaN(n) || (n !== -1 && n < 1)) return 'repeatCount 必须是 -1（永续）或 ≥1 的整数。';
  return n;
}
function parseWindow(v: unknown): number | string {
  if (v == null || str(v) === '') return 1;
  const n = parseInt(str(v), 10);
  if (!Number.isInteger(n) || n < 1) return 'windowN 必须是 ≥1 的整数。';
  if (n >= 2 && n % 2 !== 0) return 'windowN ≥2 时必须为偶数。';
  return n;
}

async function readAgentInfo(dataDir: string, agentId: string): Promise<{ name: string; sandboxLevel: string; canWriteFiles: boolean } | null> {
  try {
    const reg = JSON.parse(await fs.readFile(agentRegistryFile(dataDir), 'utf-8')) as Record<string, {
      name?: string; config?: { sandboxLevel?: string; tools?: string[] };
    }>;
    const a = reg[agentId];
    if (!a) return null;
    return {
      name: a.name || agentId,
      sandboxLevel: normalizeSandboxLevel(a.config?.sandboxLevel),
      canWriteFiles: (a.config?.tools || []).some(t => WRITE_TOOLS.includes(t)),
    };
  } catch { return null; }
}

/** selfLoop 预设：强制 accumulate + 窗口2 + 永续 + 锚定原始目标（对齐潮汐路由 applySelfLoop）。 */
function applySelfLoopPreset(task: TideTask): void {
  task.windowN = 2;
  task.repeatCount = -1;
  if (!task.originalPrompt) task.originalPrompt = task.prompt;
}

function resultLine(mode: 'created' | 'updated', task: TideTask): string {
  const flags = [task.repeatCount === -1 ? '永续' : `${task.repeatCount} 次`, task.selfLoop ? '自循环' : null].filter(Boolean).join(' · ');
  const verb = mode === 'created' ? '已创建' : '已更新';
  return `${verb}潮汐任务「${task.name}」(id: ${task.id}，${task.schedule}，${flags})，当前${task.enabled ? '运行中' : '未启用'}。启用/暂停由用户在潮汐页操作，你无法自行启动；继续调整请用 update_automation 带上此 id。`;
}
function pendingOf(mode: 'created' | 'updated', task: TideTask, info: { name: string; sandboxLevel: string; canWriteFiles: boolean }): PendingAutomation {
  return {
    mode, taskId: task.id, name: task.name, schedule: task.schedule,
    repeatCount: task.repeatCount, perpetual: task.repeatCount === -1,
    selfLoop: task.selfLoop, windowN: task.windowN, enabled: task.enabled,
    agentName: info.name, sandboxLevel: info.sandboxLevel, canWriteFiles: info.canWriteFiles,
    promptPreview: task.prompt.length > 200 ? task.prompt.slice(0, 200) + '…' : task.prompt,
  };
}

// ── create ───────────────────────────────────────────────────────
export async function execCreateAutomation(
  dataDir: string, agentId: string, rawArgs: Record<string, unknown>,
): Promise<{ result: string; pending?: PendingAutomation }> {
  const args = extract(rawArgs);
  const name = str(args.name), schedule = str(args.schedule), prompt = str(args.prompt);
  if (!name || !schedule || !prompt) return fail('缺少必填字段 name / schedule / prompt。');

  const sErr = validateSchedule(schedule); if (sErr) return fail(sErr);
  const rc = parseRepeat(args.repeatCount); if (typeof rc === 'string') return fail(rc);
  const wn = parseWindow(args.windowN); if (typeof wn === 'string') return fail(wn);
  const selfLoop = parseBool(args.selfLoop);

  const info = await readAgentInfo(dataDir, agentId);
  if (!info) return fail(`agent 不存在：${agentId}`);

  const task: TideTask = {
    id: genId(), name, schedule, prompt, agentId,
    repeatCount: rc, pushMode: 'accumulate', windowN: wn,
    roundSeq: 0, archiveBatch: 0, selfLoop, consecutiveErrors: 0,
    enabled: false,                       // 启动权在人：AI 建的一律未启用
    createdAt: new Date().toISOString(),
  };
  if (selfLoop) applySelfLoopPreset(task);
  await upsertTask(dataDir, task);
  return { result: resultLine('created', task), pending: pendingOf('created', task, info) };
}

// ── update（按 id 改；enabled / 运行时字段一律保留）─────────────────
export async function execUpdateAutomation(
  dataDir: string, _agentId: string, rawArgs: Record<string, unknown>,
): Promise<{ result: string; pending?: PendingAutomation }> {
  const args = extract(rawArgs);
  const taskId = str(args.taskId);
  if (!taskId) return fail('缺少 taskId（先用 list_automations 查看现有任务 id）。');
  const task = await getTask(dataDir, taskId);
  if (!task) return fail(`任务不存在：${taskId}`);

  // 仅改传入字段；enabled / id / createdAt / 运行时统计一律不动
  if (str(args.name)) task.name = str(args.name);
  if (str(args.schedule)) {
    const e = validateSchedule(str(args.schedule)); if (e) return fail(e);
    task.schedule = str(args.schedule);
  }
  if (str(args.prompt)) task.prompt = str(args.prompt);
  if (args.repeatCount != null && str(args.repeatCount) !== '') {
    const rc = parseRepeat(args.repeatCount); if (typeof rc === 'string') return fail(rc);
    task.repeatCount = rc;
  }
  if (args.windowN != null && str(args.windowN) !== '') {
    const wn = parseWindow(args.windowN); if (typeof wn === 'string') return fail(wn);
    task.windowN = wn;
  }
  if (args.selfLoop != null && str(args.selfLoop) !== '') {
    task.selfLoop = parseBool(args.selfLoop);
    if (task.selfLoop) applySelfLoopPreset(task);
  }

  await upsertTask(dataDir, task);
  const info = await readAgentInfo(dataDir, task.agentId);
  return { result: resultLine('updated', task), pending: info ? pendingOf('updated', task, info) : undefined };
}

// ── list（供 AI 查 id 后再 update）──────────────────────────────────
export async function execListAutomations(dataDir: string): Promise<string> {
  const tasks = await loadTasks(dataDir);
  if (!tasks.length) return '当前没有潮汐任务。';
  const rows = tasks.map(t => ({
    taskId: t.id, name: t.name, schedule: t.schedule,
    repeat: t.repeatCount === -1 ? '永续' : `${t.repeatCount}次`,
    selfLoop: t.selfLoop, enabled: t.enabled, agentId: t.agentId,
  }));
  return JSON.stringify(rows, null, 2);
}
