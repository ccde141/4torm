/**
 * 任务板 —— 假工具 task_board 的服务端执行逻辑（引擎共用）
 *
 * 与 ask/delegate 同级：不进 tools/registry.json，由各引擎的 toolCaller 按名拦截、
 * 服务端 inline 执行。后端单一落盘（真相源），前端只镜像。
 * 路径：data/agents/{agentId}/sessions/{sessionId}.taskboard.json
 * 返回的 meta.taskboard 走 UI 侧通道即时刷新面板，绝不进入 LLM 结果字符串（不污染 token）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentTaskboardFile } from '../../services/data-paths.js';

export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export interface Task { id: string; title: string; status: TaskStatus; note?: string }
export interface TaskBoard { goal: string; tasks: Task[]; updatedAt: number }

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'blocked'];

export function taskboardFile(dataDir: string, agentId: string, sessionId: string): string {
  return agentTaskboardFile(dataDir, agentId, sessionId);
}

export function taskboardTempFile(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

export function readTaskboard(fp: string): TaskBoard | null {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}

function normalizeTasks(raw: unknown): Task[] {
  let arr = raw;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 100).map((t: any, i: number) => ({
    id: String(t?.id || `t${i + 1}`),
    title: String(t?.title ?? '').slice(0, 200),
    status: STATUSES.includes(t?.status) ? t.status : 'todo',
    ...(t?.note ? { note: String(t.note).slice(0, 500) } : {}),
  })).filter((t: Task) => t.title);
}

export function summarizeTaskboard(board: TaskBoard | null): string {
  if (!board || !board.tasks.length) return '任务板为空';
  const done = board.tasks.filter(t => t.status === 'done').length;
  const doing = board.tasks.filter(t => t.status === 'doing').map(t => t.title);
  const blocked = board.tasks.filter(t => t.status === 'blocked').map(t => t.title);
  let s = `进度 ${done}/${board.tasks.length}`;
  if (doing.length) s += `；进行中：${doing.join('、')}`;
  if (blocked.length) s += `；受阻：${blocked.join('、')}`;
  return s;
}

/**
 * 执行 task_board 假工具。返回给 toolCaller：result 进 LLM，meta 走 UI 侧通道。
 * @param boardFile 任务板落盘绝对路径（各模式自行定位；null = 无会话上下文，不支持）
 */
export function execTaskBoard(
  boardFile: string | null,
  args: Record<string, any>,
): { result: string; meta?: { taskboard: TaskBoard | null } } {
  if (!boardFile) {
    return { result: '任务板需要会话上下文（本次调用缺少会话定位），当前环境暂不支持任务板。' };
  }
  const fp = boardFile;
  const action = args.action || 'set';

  if (action === 'get') {
    const board = readTaskboard(fp);
    if (!board) return { result: '任务板为空。可用 task_board(action:"set", goal, tasks) 创建。' };
    return { result: summarizeTaskboard(board), meta: { taskboard: board } };
  }

  if (action === 'clear') {
    try { fs.rmSync(fp, { force: true }); } catch { /* ignore */ }
    return { result: '任务板已清空', meta: { taskboard: null } };
  }

  // set：整体覆盖写入
  const board: TaskBoard = {
    goal: String(args.goal ?? '').slice(0, 500),
    tasks: normalizeTasks(args.tasks),
    updatedAt: Date.now(),
  };
  if (!board.tasks.length) {
    return { result: '任务板未更新：tasks 为空或格式不对，请传入 [{ title, status }] 数组。' };
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  // 原子写：先写 .tmp 再 renameSync 覆盖，防止进程中途被杀留下半截 JSON 损坏任务板。
  const tmp = taskboardTempFile(fp);
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf-8');
  fs.renameSync(tmp, fp);
  return { result: `任务板已更新：${summarizeTaskboard(board)}`, meta: { taskboard: board } };
}

const STATUS_MARK: Record<string, string> = { done: '[x]', doing: '[~]', blocked: '[!]', todo: '[ ]' };

/**
 * system prompt 片段：始终描述 task_board 用法；已有板子时附当前状态。
 * 与 buildDelegateSection / buildAskSection 同级，各引擎 prompt-builder 复用。
 */
export function buildTaskBoardSection(board: TaskBoard | null): string {
  const usage = `### task_board
  描述: 维护本会话的任务板（用户可见的结构化进度清单）。它有两个作用——让用户实时看到你的计划与进度，同时**是你给自己的工作备忘**：把大任务拆成子任务落在板上，逐项推进，不漏步、不跑偏。
  参数:
    action: string [必填] — set=整体覆盖写入 / get=读取当前板子 / clear=清空
    goal: string [可选] — （set 时）本会话总目标，一句话
    tasks: array [可选] — （set 时）完整任务列表，覆盖式写入，须含所有任务的最新状态。每项 { title: 标题, status: "todo"|"doing"|"done"|"blocked", note?: 备注 }

  何时主动建板（满足任一，先拆解再动手）：
  - 预计需要 ≥3 步，或要跨多轮才能完成
  - 涉及多个文件 / 多个环节 / 多项并列要求
  - 难度较大、容易遗漏细节或中途跑偏
  （单步问答、一眼能答完的不必建板。）

  用它自我提醒（关键，别只建不更）：
  - **开工前先拆解**：动手前把任务拆成有序子任务、写清 goal，一次 set 落板
  - **推进即更新**：开始某项前把它标 doing，做完标 done；受阻标 blocked 并在 note 写原因
  - **每步前瞥一眼板子**：确认下一项该做什么、有没有漏的，再继续
  - set 是**整体覆盖**：每次都要带上所有任务（含未变动的），不是增量追加

  调用示例：<action tool="task_board">{"action":"set","goal":"实现登录","tasks":[{"title":"设计接口","status":"done"},{"title":"写代码","status":"doing"},{"title":"写测试","status":"todo"}]}</action>`;

  if (!board?.tasks?.length) return usage;

  const lines = board.tasks.map(t => `- ${STATUS_MARK[t.status] ?? '[ ]'} ${t.title}${t.note ? `　（${t.note}）` : ''}`).join('\n');
  return `${usage}

#### 当前任务板状态
${board.goal ? `目标：${board.goal}\n` : ''}${lines}

标记含义：[x] 已完成　[~] 进行中　[ ] 待办　[!] 受阻
**推进前先看板子确认下一项；每当开始或完成一项，及时用 task_board(action:"set") 覆盖更新整个板子，别让它停在过期状态。**`;
}
