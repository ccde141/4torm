import { readJson } from '../api/storage';

/** 任务状态：待办 / 进行中 / 完成 / 受阻 */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  note?: string;
}

export interface TaskBoard {
  goal: string;
  tasks: Task[];
  updatedAt: number;
  revision: number;
}

interface TaskboardMutationResponse {
  result?: string;
  meta?: { taskboard: TaskBoard | null };
}

export class TaskboardConflictError extends Error {
  readonly current: TaskBoard | null;

  constructor(message: string, current: TaskBoard | null) {
    super(message);
    this.name = 'TaskboardConflictError';
    this.current = current;
  }
}

export const STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'done', 'blocked'];

/** 后端 task_board.js 落盘的同一路径，前端读写镜像它（单一真相源） */
export function taskboardPath(sessionId: string): string {
  const parts = sessionId.split('-');
  const agentId = `${parts[0]}-${parts[1]}`; // agent-xxx
  return `agents/${agentId}/sessions/${sessionId}.taskboard.json`;
}

export async function loadTaskboard(sessionId: string): Promise<TaskBoard | null> {
  try {
    return normalizeBoard(await readJson<TaskBoard>(taskboardPath(sessionId)));
  } catch {
    return null;
  }
}

/** 保存整块任务板（null = 清空 → 删文件），前端用户编辑后调用 */
export function saveTaskboard(
  sessionId: string,
  board: TaskBoard | null,
  expectedRevision = board?.revision ?? 0,
): Promise<TaskBoard | null> {
  return mutateTaskboard(taskboardPath(sessionId), board, expectedRevision);
}

// ── 气旋工位任务板：与工位数据同目录（data/cyclone/{workshopId}/seats/{seatId}.taskboard.json） ──
export function seatTaskboardPath(workshopId: string, seatId: string): string {
  return `cyclone/${workshopId}/seats/${seatId}.taskboard.json`;
}

export async function loadSeatTaskboard(workshopId: string, seatId: string): Promise<TaskBoard | null> {
  try {
    return normalizeBoard(await readJson<TaskBoard>(seatTaskboardPath(workshopId, seatId)));
  } catch {
    return null;
  }
}

export function saveSeatTaskboard(
  workshopId: string,
  seatId: string,
  board: TaskBoard | null,
  expectedRevision = board?.revision ?? 0,
): Promise<TaskBoard | null> {
  return mutateTaskboard(seatTaskboardPath(workshopId, seatId), board, expectedRevision);
}

async function mutateTaskboard(
  filePath: string,
  board: TaskBoard | null,
  expectedRevision: number,
): Promise<TaskBoard | null> {
  const response = await fetch('/api/taskboard/mutate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: filePath,
      action: board?.tasks.length ? 'set' : 'clear',
      expectedRevision,
      goal: board?.goal,
      tasks: board?.tasks,
    }),
  });
  const payload = await response.json().catch(() => ({})) as TaskboardMutationResponse;
  if (response.status === 409) {
    throw new TaskboardConflictError(payload.result || '任务板版本冲突', payload.meta?.taskboard ?? null);
  }
  if (!response.ok) throw new Error(payload.result || `任务板保存失败: ${response.status}`);
  return payload.meta?.taskboard ?? null;
}

function normalizeBoard(board: TaskBoard | null): TaskBoard | null {
  if (!board) return null;
  const revision = Number.isInteger(board.revision) && board.revision >= 0 ? board.revision : 0;
  return { ...board, revision };
}

export function taskboardProgress(board: TaskBoard | null): { done: number; total: number } {
  if (!board?.tasks.length) return { done: 0, total: 0 };
  return { done: board.tasks.filter(t => t.status === 'done').length, total: board.tasks.length };
}
