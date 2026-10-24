import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ConvectionSessionService } from '../application/session-service.js';

export function convectionReadManifests(): ModuleMethodManifest[] {
  return ['listSessions', 'readSession'].map(id => ({
    id, kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' },
  }));
}

export function convectionReadHandlers(sessions: ConvectionSessionService): Record<string, ModuleMethodHandler> {
  return {
    listSessions: { parse: parseEmpty, invoke: () => sessions.list() },
    readSession: { parse: parseSession,
      invoke: (_context, input) => sessions.read((input as { sessionId: string }).sessionId) },
  };
}

function parseEmpty(value: unknown): Record<string, never> {
  const item = record(value);
  if (Object.keys(item).length) throw invalid();
  return {};
}

function parseSession(value: unknown): { sessionId: string } {
  const item = record(value);
  if (Object.keys(item).some(key => key !== 'sessionId') ||
    typeof item.sessionId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.sessionId)) throw invalid();
  return { sessionId: item.sessionId };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw frameworkError({ code: 'CONVECTION_READ_INPUT_INVALID', kind: 'validation',
    message: '对流读取参数无效', source: 'convection.read', retryable: false });
}
