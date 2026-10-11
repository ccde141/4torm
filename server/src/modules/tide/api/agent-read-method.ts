import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideTaskService } from '../application/task-service.js';

export const agentTaskDetailManifest: ModuleMethodManifest = {
  id: 'getAutomation', kind: 'query', permission: 'observe',
  audiences: ['agent', 'internal'],
  agentTool: { name: 'get_automation',
    description: '读取潮汐任务完整配置与最近运行索引；运行正文请按 ID 使用记录读取工具。' },
  inputSchema: { type: 'object', additionalProperties: false, required: ['taskId'],
    properties: { taskId: { type: 'string', minLength: 1 } } },
  output: { mode: 'inline' },
};

export function agentTaskDetailHandler(tasks: TideTaskService): ModuleMethodHandler {
  return {
    parse: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => key !== 'taskId')
        || typeof input.taskId !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(input.taskId)) throw invalid();
      return { taskId: input.taskId };
    },
    invoke: async (_context, input) => {
      const { task, recent } = await tasks.detail((input as { taskId: string }).taskId);
      return { task, recent: recent.map(run => ({
        runId: run.runId, timestamp: run.timestamp, status: run.status,
        ...(run.error ? { error: run.error } : {}),
      })) };
    },
  };
}

function invalid(): never {
  throw frameworkError({ code: 'TIDE_AUTOMATION_INPUT_INVALID', kind: 'validation',
    message: '潮汐任务详情参数无效', source: 'tide.agent-read', retryable: false });
}
