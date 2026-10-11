import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideTargetSessions } from '../application/target-sessions.js';

export const targetSessionManifest: ModuleMethodManifest = {
  id: 'listTargetSessions', kind: 'query', permission: 'observe',
  audiences: ['agent', 'internal'],
  agentTool: { name: 'list_automation_targets',
    description: '列出某个 Agent 已有的季风会话 ID，供潮汐指定会话追加使用。' },
  inputSchema: { type: 'object', additionalProperties: false,
    properties: { agentId: { type: 'string' }, cursor: { type: 'string' } } },
  output: { mode: 'inline' },
};

export function targetSessionHandler(targets: TideTargetSessions): ModuleMethodHandler {
  return {
    parse: input => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
      const args = input as Record<string, unknown>;
      if (Object.keys(args).some(key => key !== 'agentId' && key !== 'cursor')
        || (args.agentId !== undefined && !validId(args.agentId))
        || (args.cursor !== undefined && typeof args.cursor !== 'string')) throw invalid();
      return args;
    },
    invoke: (context, input) => {
      const args = input as { agentId?: string; cursor?: string };
      return targets.list(args.agentId ?? context.actor.id, args.cursor);
    },
  };
}

function validId(value: unknown): boolean {
  return typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function invalid(): never {
  throw frameworkError({ code: 'TIDE_TARGET_INPUT_INVALID', kind: 'validation',
    message: '潮汐目标会话查询参数无效', source: 'tide.targets', retryable: false });
}
