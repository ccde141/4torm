import type {
  ModuleMethodHandler,
  ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export interface ConvectionWorkspacePort {
  open(sessionId: string): Promise<string>;
}

export function convectionWorkspaceManifest(): ModuleMethodManifest {
  return {
    id: 'openWorkspace', kind: 'command', permission: 'administer',
    audiences: ['human', 'internal'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: { type: 'string' } },
    },
    output: { mode: 'inline' },
  };
}

export function convectionWorkspaceHandler(
  workspace: ConvectionWorkspacePort,
): ModuleMethodHandler {
  return {
    parse: parseSession,
    invoke: async (_context, input) => ({
      ok: true,
      path: await workspace.open((input as { sessionId: string }).sessionId),
    }),
  };
}

function parseSession(value: unknown): { sessionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'sessionId')
    || typeof record.sessionId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record.sessionId)) throw invalidInput();
  return { sessionId: record.sessionId };
}

function invalidInput(): never {
  throw frameworkError({ code: 'CONVECTION_WORKSPACE_INPUT_INVALID', kind: 'validation',
    message: '对流工作区参数无效', source: 'convection.workspace', retryable: false });
}
