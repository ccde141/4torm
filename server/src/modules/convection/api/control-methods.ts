import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  AbortConvectionRoundCommand,
  ConvectionCommands,
} from '../application/round-commands.js';

export function convectionControlManifests(): ModuleMethodManifest[] {
  return [{
    id: 'abortRound', kind: 'command', permission: 'intervene',
    audiences: ['human', 'internal'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId', 'runId'],
      properties: { sessionId: { type: 'string' }, runId: { type: 'string' } },
    },
    output: { mode: 'inline' },
  }];
}

export function convectionControlHandlers(
  commands: ConvectionCommands,
): Record<string, ModuleMethodHandler> {
  return {
    abortRound: {
      parse: parseAbort,
      invoke: async (_context, input) => commands.abort(input as AbortConvectionRoundCommand),
    },
  };
}

function parseAbort(value: unknown): AbortConvectionRoundCommand {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'sessionId' && key !== 'runId')
    || !isIdentifier(value.sessionId) || !isIdentifier(value.runId)) throw invalidInput();
  return { sessionId: value.sessionId, runId: value.runId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

function invalidInput() {
  return frameworkError({
    code: 'CONVECTION_INPUT_INVALID', kind: 'validation', message: '对流控制参数无效',
    source: 'convection.module', retryable: false,
  });
}
