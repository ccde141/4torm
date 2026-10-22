import {
  agentToolOutput,
  type ModuleMethodHandler,
  type ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideAgentAutomationService } from '../application/automation-tools.js';
import type { TideTaskService } from '../application/task-service.js';

const commonProperties = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  schedule: { type: 'string', minLength: 1, maxLength: 100,
    description: '间隔格式 every 5m（Agent 最短60秒）；每天定时格式 daily 08:00，24小时制，按后端电脑当前时区。后端关闭期间错过的每天定时不补跑。' },
  prompt: { type: 'string', minLength: 1, maxLength: 20_000 },
  agentId: { type: 'string', minLength: 1,
    description: '执行任务的池内 Agent；更新时可更换，任务或目标会话忙碌时拒绝。累积模式换绑会建立独立会话，旧会话与记录保留。' },
  pushMode: { type: 'string', enum: ['accumulate', 'designated'] },
  targetSessionId: { type: 'string', minLength: 1,
    description: 'designated 模式的已有季风会话；更换 Agent 时必须明确提供新 Agent 所属会话。累积模式换绑不填写此项。' },
  repeatCount: { type: 'string' },
  windowN: { type: 'string' },
  selfLoop: { type: 'string' },
};

export function tideAgentManifests(): ModuleMethodManifest[] {
  return [
    method(
      'createAutomation', 'create_automation',
      '为自己或池内 Agent 创建并启用潮汐任务；enabled=false 可先保存草稿。可指定已有季风会话。',
      ['name', 'schedule', 'prompt'], { ...commonProperties,
        enabled: { type: 'boolean', description: '默认 true；设为 false 时只保存未启用草稿。' } },
    ),
    method(
      'updateAutomation', 'update_automation',
      '修改已有潮汐任务的内容、计划或执行 Agent，不改变其启用状态。执行中或压缩中的任务不能修改；换绑后保留旧 Agent 的历史。',
      ['taskId'], { taskId: { type: 'string', minLength: 1 }, ...commonProperties },
    ),
    method('setAutomationEnabled', 'set_automation_enabled',
      '明确启用或暂停潮汐任务；重复设置同一状态不会反转。',
      ['taskId', 'enabled'], { taskId: { type: 'string', minLength: 1 },
        enabled: { type: 'boolean' } }, 'intervene'),
  ];
}

export function tideAgentHandlers(
  automations: TideAgentAutomationService,
  tasks: TideTaskService,
): Record<string, ModuleMethodHandler> {
  return {
    createAutomation: handler(input => automations.create(input.actorId, input.args)),
    updateAutomation: handler(input => automations.update(input.actorId, input.args)),
    setAutomationEnabled: {
      parse: parseArgs,
      invoke: async (_context, input) => {
        const args = input as Record<string, unknown>;
        if (typeof args.taskId !== 'string' || typeof args.enabled !== 'boolean') {
          throw invalidInput();
        }
        const task = await tasks.setEnabled(args.taskId, args.enabled);
        return { taskId: task.id, enabled: task.enabled, nextRun: task.nextRun };
      },
    },
  };
}

function handler(
  invoke: (input: { actorId: string; args: Record<string, unknown> }) => Promise<{
    result: string;
    pending?: unknown;
  }>,
): ModuleMethodHandler {
  return {
    parse: parseArgs,
    invoke: async (context, input) => {
      const output = await invoke({ actorId: context.actor.id, args: input as Record<string, unknown> });
      return agentToolOutput(output.result,
        output.pending ? { pendingAutomation: output.pending } : undefined);
    },
  };
}

function method(
  id: string,
  name: string,
  description: string,
  required: string[],
  properties: Record<string, unknown>,
  permission: ModuleMethodManifest['permission'] = 'design',
): ModuleMethodManifest {
  return {
    id, kind: 'command', permission, audiences: ['agent', 'internal'],
    agentTool: { name, description },
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    output: { mode: 'inline' },
  };
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    'params', 'taskId', 'name', 'schedule', 'prompt', 'repeatCount', 'windowN', 'selfLoop',
    'agentId', 'pushMode', 'targetSessionId', 'enabled',
  ]);
  if (Object.keys(record).some(key => !allowed.has(key))) throw invalidInput();
  return record;
}

function invalidInput() {
  return frameworkError({
    code: 'TIDE_AUTOMATION_INPUT_INVALID', kind: 'validation',
    message: '潮汐自动任务参数无效', source: 'tide.automations', retryable: false,
  });
}
