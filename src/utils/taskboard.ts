import { readJson, writeJson, deleteFile } from '../api/storage';

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
    return await readJson<TaskBoard>(taskboardPath(sessionId));
  } catch {
    return null;
  }
}

/** 保存整块任务板（null = 清空 → 删文件），前端用户编辑后调用 */
export async function saveTaskboard(sessionId: string, board: TaskBoard | null): Promise<void> {
  if (board === null || !board.tasks.length) {
    await deleteFile(taskboardPath(sessionId)).catch(() => {});
    return;
  }
  await writeJson(taskboardPath(sessionId), { ...board, updatedAt: Date.now() });
}

// ── 气旋工位任务板：与工位数据同目录（data/cyclone/{workshopId}/seats/{seatId}.taskboard.json） ──
export function seatTaskboardPath(workshopId: string, seatId: string): string {
  return `cyclone/${workshopId}/seats/${seatId}.taskboard.json`;
}

export async function loadSeatTaskboard(workshopId: string, seatId: string): Promise<TaskBoard | null> {
  try {
    return await readJson<TaskBoard>(seatTaskboardPath(workshopId, seatId));
  } catch {
    return null;
  }
}

export async function saveSeatTaskboard(workshopId: string, seatId: string, board: TaskBoard | null): Promise<void> {
  if (board === null || !board.tasks.length) {
    await deleteFile(seatTaskboardPath(workshopId, seatId)).catch(() => {});
    return;
  }
  await writeJson(seatTaskboardPath(workshopId, seatId), { ...board, updatedAt: Date.now() });
}

export function taskboardProgress(board: TaskBoard | null): { done: number; total: number } {
  if (!board?.tasks.length) return { done: 0, total: 0 };
  return { done: board.tasks.filter(t => t.status === 'done').length, total: board.tasks.length };
}
