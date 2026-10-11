import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideScheduler } from '../runtime/scheduler.js';

export const scheduledMethodManifest: ModuleMethodManifest = {
  id: 'triggerScheduledTask', kind: 'command', permission: 'execute',
  audiences: ['internal'],
  inputSchema: { type: 'object', additionalProperties: false, required: ['taskId'],
    properties: { taskId: { type: 'string', minLength: 1 } } },
  output: { mode: 'operation' },
};

export function scheduledMethodHandler(scheduler: TideScheduler): ModuleMethodHandler {
  return {
    parse: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 1
        || typeof (value as { taskId?: unknown }).taskId !== 'string'
        || !(value as { taskId: string }).taskId.trim()) {
        throw frameworkError({ code: 'TIDE_SCHEDULE_INPUT_INVALID', kind: 'validation',
          message: '潮汐定时触发参数无效', source: 'tide.module', retryable: false });
      }
      return { taskId: (value as { taskId: string }).taskId };
    },
    invoke: async (_context, input) => {
      const taskId = (input as { taskId: string }).taskId;
      const runId = await scheduler.runScheduled(taskId);
      return { operationId: taskId, taskId, runId, accepted: true };
    },
  };
}
