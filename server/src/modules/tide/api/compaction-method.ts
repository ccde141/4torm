import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideSessionCompaction } from '../application/session-compaction.js';

export const tideCompactionManifest: ModuleMethodManifest = {
  id: 'compactSession', kind: 'command', permission: 'administer', audiences: ['human', 'internal'],
  inputSchema: { type: 'object', additionalProperties: false, required: ['agentId', 'sessionId'],
    properties: { agentId: { type: 'string' }, sessionId: { type: 'string' } } },
  output: { mode: 'inline' },
};

export function tideCompactionHandler(port: TideSessionCompaction): ModuleMethodHandler {
  return { parse: value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'agentId' && key !== 'sessionId')
      || !identifier(input.agentId) || !identifier(input.sessionId)) throw invalid();
    return { agentId: input.agentId, sessionId: input.sessionId };
  }, invoke: (context, value) => {
    const input = value as { agentId: string; sessionId: string };
    return port.compact(input.agentId, input.sessionId, context.signal);
  } };
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}
function invalid() {
  return frameworkError({ code: 'TIDE_COMPACTION_INPUT_INVALID', kind: 'validation',
    message: '潮汐会话压缩参数无效', source: 'tide.compaction', retryable: false });
}
