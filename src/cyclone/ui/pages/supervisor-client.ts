import { backendFetch } from '../../../lib/backend-client';
import { errorFromResponse } from '../../../api/error-contract';
import { streamUrl } from '../../../lib/apiBase';
import { TaskboardConflictError, type TaskBoard } from '../../../utils/taskboard';
import { abortCycloneExecution } from './cyclone-execution-client';
import { readCycloneSSE } from './cyclone-sse';

export const SUPERVISOR_STREAM_KEY = '__supervisor__';
export const supervisorBase = (workshopId: string) => `/api/cyclone/workshop/${workshopId}/supervisor`;

export interface SupervisorStatus {
  id: 'supervisor'; title: string; agentId?: string; rolePrompt: string;
  messages: Array<{ role: string; content: string }>;
  configured: boolean; updatedAt: string;
}

async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await backendFetch(url, { method, signal, ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json() as Promise<T>;
}

export const readSupervisor = (workshopId: string, signal?: AbortSignal) =>
  request<SupervisorStatus>(`${supervisorBase(workshopId)}/status`, 'GET', undefined, signal);

export const configureSupervisor = (workshopId: string, agentId: string, rolePrompt: string) =>
  request<SupervisorStatus>(`${supervisorBase(workshopId)}/config`, 'PUT', { agentId, rolePrompt });

export const mutateSupervisorMessage = (workshopId: string, index: number, content?: string) =>
  request(`${supervisorBase(workshopId)}/message`, 'PATCH', { index, ...(content === undefined ? {} : { content }) });

export const resetSupervisor = (workshopId: string, mode: 'clear' | 'summary', signal?: AbortSignal) =>
  request(`${supervisorBase(workshopId)}/reset`, 'POST', { mode }, signal);

export async function compactSupervisor(workshopId: string, signal?: AbortSignal): Promise<void> {
  let execution: { operationId: string; runId: string } | undefined;
  let failure = '';
  const abort = () => {
    if (execution) void abortCycloneExecution(execution.operationId, execution.runId).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await backendFetch(streamUrl(`${supervisorBase(workshopId)}/compact`), { method: 'POST', signal });
    if (!response.ok) throw await errorFromResponse(response);
    await readCycloneSSE(response, event => {
      if (event.type === 'execution-start' && typeof event.operationId === 'string' && typeof event.runId === 'string') {
        execution = { operationId: event.operationId, runId: event.runId };
      }
      if (event.type === 'error') failure = String(event.message ?? event.error ?? 'Compaction failed');
    }, signal);
    if (failure) throw new Error(failure);
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function loadSupervisorTaskboard(workshopId: string): Promise<TaskBoard | null> {
  const result = await request<TaskBoard | null | { meta?: { taskboard: TaskBoard | null } }>(
    `${supervisorBase(workshopId)}/taskboard`);
  return result && 'meta' in result ? result.meta?.taskboard ?? null : result as TaskBoard | null;
}

/** Delayed live pages must not roll back the newer board; a clear still removes it. */
export function reconcileSupervisorTaskboard(current: TaskBoard | null, next: TaskBoard | null): TaskBoard | null {
  if (!current || !next) return next;
  return next.updatedAt < current.updatedAt
    || next.updatedAt === current.updatedAt && next.revision < current.revision ? current : next;
}

export async function saveSupervisorTaskboard(
  workshopId: string, board: TaskBoard | null, expectedRevision: number,
): Promise<TaskBoard | null> {
  const response = await backendFetch(`${supervisorBase(workshopId)}/taskboard`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board, expectedRevision }) });
  const result = await response.json();
  if (response.status === 409) throw new TaskboardConflictError(result.error ?? result.result,
    result.current ?? result.meta?.taskboard ?? null);
  if (!response.ok) throw new Error(result.error ?? result.result ?? `Taskboard request failed (${response.status})`);
  return result?.meta && 'taskboard' in result.meta ? result.meta.taskboard : result;
}
