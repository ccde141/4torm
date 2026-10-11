import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonCompactionService } from '../application/compaction-service.js';

export function monsoonCompactionManifest(): ModuleTransportManifest {
  return { id: 'compaction', permission: 'execute', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false },
  };
}

export function monsoonCompactionHandler(service: MonsoonCompactionService): ModuleTransportHandler {
  return { parse, prepare: (_context, input) => service.prepare(input as ReturnType<typeof parse>) };
}

function parse(value: unknown): { agentId: string; sessionId: string; model?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['agentId', 'sessionId', 'model'].includes(key))) throw invalid();
  return { agentId: id(item.agentId), sessionId: id(item.sessionId),
    ...(item.model === undefined ? {} : { model: text(item.model) }) };
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) throw invalid();
  return value;
}

function invalid(): never {
  throw frameworkError({ code: 'MONSOON_COMPACTION_INPUT_INVALID', kind: 'validation',
    message: '压缩参数无效', source: 'monsoon.compaction', retryable: false });
}
