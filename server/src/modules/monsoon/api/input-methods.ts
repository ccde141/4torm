import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { monsoonInputError, type MonsoonInputOwner, type MonsoonInputService } from '../application/input-service.js';

export function monsoonInputManifests(): ModuleMethodManifest[] {
  return [
    { id: 'submitInput', kind: 'command', permission: 'intervene', audiences: ['human', 'internal'],
      inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } },
    { id: 'inspectInput', kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
      inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } },
  ];
}

export function monsoonInputHandlers(service: MonsoonInputService): Record<string, ModuleMethodHandler> {
  return {
    submitInput: { parse: value => parse(value, true),
      invoke: (_context, input) => {
        const item = input as MonsoonInputOwner & { id: string; content: string };
        return service.submit(item, { id: item.id, content: item.content });
      } },
    inspectInput: { parse: value => parse(value, false),
      invoke: (_context, input) => service.inspect(input as MonsoonInputOwner) },
  };
}

function parse(value: unknown, submission: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  const keys = submission ? ['agentId', 'sessionId', 'runId', 'id', 'content']
    : ['agentId', 'sessionId', 'runId'];
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  const owner = { agentId: ownerId(item.agentId), sessionId: ownerId(item.sessionId),
    runId: ownerId(item.runId) };
  if (!submission) return owner;
  if (typeof item.id !== 'string' || typeof item.content !== 'string') throw invalid();
  return { ...owner, id: item.id, content: item.content };
}

function ownerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw invalid();
  return value;
}

function invalid(): never {
  throw monsoonInputError('INPUT_INVALID', 'validation', '插话参数无效');
}
