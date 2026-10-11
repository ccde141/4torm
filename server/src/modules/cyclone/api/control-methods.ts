import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneCommands,
  CycloneExecutionIdentity,
} from '../application/execution-commands.js';

export function cycloneControlManifests(): ModuleMethodManifest[] {
  return [{
    id: 'abortExecution', kind: 'command', permission: 'intervene',
    audiences: ['human', 'internal'], inputSchema: objectSchema(),
    output: { mode: 'inline' },
  }];
}

export function cycloneControlHandlers(commands: CycloneCommands): Record<string, ModuleMethodHandler> {
  return {
    abortExecution: { parse: parseIdentity, invoke: async (_context, input) => commands.abort(input as CycloneExecutionIdentity) },
  };
}

function parseIdentity(value: unknown): CycloneExecutionIdentity {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'operationId' && key !== 'runId')
    || !isId(value.operationId) || !isId(value.runId)) throw invalidInput();
  return { operationId: value.operationId, runId: value.runId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function objectSchema(): Record<string, unknown> { return { type: 'object', additionalProperties: false }; }

function invalidInput() {
  return frameworkError({
    code: 'CYCLONE_INPUT_INVALID', kind: 'validation', message: '气旋执行参数无效',
    source: 'cyclone.module', retryable: false,
  });
}
