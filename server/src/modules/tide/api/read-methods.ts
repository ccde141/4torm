import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideTaskService } from '../application/task-service.js';

const names = ['readTaskList', 'readTaskDetail', 'readTaskRuns', 'readSessions', 'readSession'];

export function tideReadManifests(): ModuleMethodManifest[] {
  return names.map(id => ({ id, kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false },
    output: { mode: 'inline' },
  }));
}

export function tideReadHandlers(tasks: TideTaskService): Record<string, ModuleMethodHandler> {
  return {
    readTaskList: { parse: empty, invoke: () => tasks.list() },
    readTaskDetail: { parse: value => ids(value, ['taskId']),
      invoke: (_context, input) => tasks.detail((input as { taskId: string }).taskId) },
    readTaskRuns: { parse: runs,
      invoke: (_context, input) => {
        const item = input as { taskId: string; limit: number };
        return tasks.listRuns(item.taskId, item.limit);
      } },
    readSessions: { parse: value => ids(value, ['agentId']),
      invoke: async (_context, input) => (await tasks.listSessions(
        (input as { agentId: string }).agentId)).map(session => ({
          id: session.id, agentId: session.agentId, agentName: session.agentName,
          title: session.title, model: session.model, messageCount: session.messages.length,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
        })) },
    readSession: { parse: value => ids(value, ['agentId', 'sessionId']),
      invoke: (_context, input) => {
        const item = input as { agentId: string; sessionId: string };
        return tasks.readSession(item.agentId, item.sessionId);
      } },
  };
}

function runs(value: unknown) {
  const item = record(value, ['taskId', 'limit']);
  const limit = item.limit === undefined ? 20 : Number(item.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
  return { taskId: id(item.taskId), limit };
}

function ids(value: unknown, keys: string[]): Record<string, string> {
  const item = record(value, keys);
  return Object.fromEntries(keys.map(key => [key, id(item[key])]));
}

function empty(value: unknown): Record<string, never> {
  record(value, []);
  return {};
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}

function invalid(): never {
  throw frameworkError({ code: 'TIDE_TASK_INPUT_INVALID', kind: 'validation',
    message: '潮汐读取参数无效', source: 'tide.read', retryable: false });
}
