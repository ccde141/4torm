import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ModuleMethodHandler,
  ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import type { TideTask } from '../domain/task.js';
import type { CreateTideTaskInput, TideTaskService } from '../application/task-service.js';

export function tideControlManifests(): ModuleMethodManifest[] {
  return [
    command('createTask', 'design', objectSchema(), 'inline'),
    command('updateTask', 'design', taskPatchSchema(), 'inline'),
    command('toggleTask', 'intervene', taskIdSchema(), 'inline'),
    { ...command('deleteTask', 'administer', taskIdSchema(), 'inline'),
      audiences: ['human', 'agent', 'internal'],
      agentTool: { name: 'delete_automation',
        description: '删除指定潮汐任务及其潮汐运行记录和任务会话。' } },
    command('deleteSession', 'administer', taskIdSchema(), 'inline'),
    { ...command('runTask', 'execute', taskIdSchema(), 'operation'),
      audiences: ['human', 'agent', 'internal'],
      agentTool: { name: 'run_automation',
        description: '立即运行一次潮汐任务，返回任务 ID 与运行 ID，可继续检查、等待并读取记录。' } },
    { ...command('abortTaskRun', 'intervene', taskRunSchema(), 'inline'),
      audiences: ['human', 'agent', 'internal'],
      agentTool: { name: 'abort_automation',
        description: '中止指定 taskId/runId 的当前一轮潮汐执行，不暂停后续计划。accepted 仅表示中止请求已接收，随后检查或等待该 runId；保存已开始时不再接受中止。' } },
  ];
}

export function tideControlHandlers(service: TideTaskService): Record<string, ModuleMethodHandler> {
  return {
    createTask: {
      parse: parseCreate,
      invoke: async (_context, input) => {
        const task = await service.create(input as CreateTideTaskInput);
        return { taskId: task.id, created: true, task };
      },
    },
    updateTask: {
      parse: parseTaskPatch,
      invoke: async (context, input) => {
        const value = input as TaskPatchInput;
        const task = await service.update(value.taskId, value.patch, context.actor.type === 'human');
        return { taskId: value.taskId, updated: true, task };
      },
    },
    toggleTask: {
      parse: parseTaskId,
      invoke: async (_context, input) => {
        const taskId = (input as TaskIdInput).taskId;
        const task = await service.toggle(taskId);
        return { taskId, enabled: task.enabled, task };
      },
    },
    deleteTask: {
      parse: parseTaskId,
      invoke: async (_context, input) => {
        const taskId = (input as TaskIdInput).taskId;
        await service.remove(taskId);
        return { taskId, deleted: true };
      },
    },
    deleteSession: {
      parse: parseTaskId,
      invoke: async (_context, input) => {
        const taskId = (input as TaskIdInput).taskId;
        await service.removeSession(taskId);
        return { taskId, deleted: true };
      },
    },
    runTask: {
      parse: parseTaskId,
      invoke: async (context, input) => {
        const taskId = (input as TaskIdInput).taskId;
        const runId = await service.runNow(taskId, context.actor.type === 'human');
        return { operationId: taskId, taskId, runId, accepted: true };
      },
    },
    abortTaskRun: {
      parse: parseTaskRun,
      invoke: (_context, input) => {
        const value = input as TaskIdInput & { runId: string };
        return service.abortRun(value.taskId, value.runId);
      },
    },
  };
}

interface TaskIdInput { taskId: string }
interface TaskPatchInput extends TaskIdInput { patch: Partial<TideTask> }

function command(
  id: string,
  permission: ModuleMethodManifest['permission'],
  inputSchema: Record<string, unknown>,
  mode: ModuleMethodManifest['output']['mode'],
): ModuleMethodManifest {
  return {
    id, kind: 'command', permission,
    audiences: ['human', 'internal'], inputSchema,
    output: { mode },
  };
}

function parseCreate(value: unknown): CreateTideTaskInput {
  if (!isRecord(value)) throw invalidControlInput();
  return value as unknown as CreateTideTaskInput;
}

function parseTaskId(value: unknown): TaskIdInput {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'taskId')) {
    throw invalidControlInput();
  }
  return { taskId: nonEmptyText(value.taskId) };
}

function parseTaskPatch(value: unknown): TaskPatchInput {
  if (!isRecord(value)
    || Object.keys(value).some(key => key !== 'taskId' && key !== 'patch')
    || !isRecord(value.patch)) {
    throw invalidControlInput();
  }
  return { taskId: nonEmptyText(value.taskId), patch: value.patch as Partial<TideTask> };
}

function parseTaskRun(value: unknown): TaskIdInput & { runId: string } {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'taskId' && key !== 'runId')) {
    throw invalidControlInput();
  }
  return { taskId: nonEmptyText(value.taskId), runId: nonEmptyText(value.runId) };
}

function nonEmptyText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidControlInput();
  return value;
}

function objectSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: true };
}

function taskIdSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['taskId'],
    properties: { taskId: { type: 'string', minLength: 1 } },
  };
}

function taskPatchSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['taskId', 'patch'],
    properties: { taskId: { type: 'string', minLength: 1 }, patch: objectSchema() },
  };
}

function taskRunSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['taskId', 'runId'],
    properties: { taskId: { type: 'string', minLength: 1 }, runId: { type: 'string', minLength: 1 } } };
}

function invalidControlInput() {
  return frameworkError({
    code: 'TIDE_CONTROL_INPUT_INVALID', kind: 'validation',
    message: '潮汐控制参数无效', source: 'tide.module', retryable: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
