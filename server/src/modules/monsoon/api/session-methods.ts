import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import type { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import type { SessionWriteMode } from '../domain/session.js';
import type { MonsoonSession } from '../domain/session.js';
import type { CurrentInputEstimate } from '../../../engine/shared/model-request-usage.js';

export interface MonsoonSessionPorts {
  sessions: FileMonsoonSessionRepository;
  journal: FileMonsoonTurnJournal;
  preview?: (session: MonsoonSession, model?: string) => Promise<MonsoonSession & { currentInput?: CurrentInputEstimate }>;
}

export function monsoonSessionManifests(): ModuleMethodManifest[] {
  const names = [
    ['createSession', 'design'], ['listSessions', 'observe'], ['readSession', 'observe'],
    ['replaceSession', 'design'], ['deleteSession', 'administer'],
    ['previewInput', 'observe'],
  ] as const;
  return names.map(([id, permission]) => ({ id,
    kind: permission === 'observe' ? 'query' : 'command', permission,
    audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' },
  }));
}

export function monsoonSessionHandlers(ports: MonsoonSessionPorts): Record<string, ModuleMethodHandler> {
  const { sessions, journal } = ports;
  const preview = ports.preview ?? (async (session: MonsoonSession) => session);
  return {
    createSession: { parse: value => record(value),
      invoke: async (_context, input) => preview(await sessions.create(input)) },
    listSessions: { parse: value => lookup(value, false),
      invoke: async (_context, input) => {
        const agentId = (input as { agentId: string }).agentId;
        const list = await sessions.list(agentId, Boolean(ports.preview));
        if (!ports.preview) return list;
        return Promise.all(list.map(async item => {
          return { ...item, messages: [], currentInput: (await ports.preview!(item)).currentInput };
        }));
      } },
    previewInput: { parse: parsePreview,
      invoke: async (_context, input) => {
        const { agentId, sessionId, model } = input as { agentId: string; sessionId: string; model?: string };
        const session = await sessions.get(agentId, sessionId);
        return session ? (await preview(session, model) as MonsoonSession & { currentInput?: CurrentInputEstimate }).currentInput ?? null : null;
      } },
    readSession: { parse: value => lookup(value, true),
      invoke: async (_context, input) => {
        const { agentId, sessionId } = input as { agentId: string; sessionId: string };
        const session = await sessions.get(agentId, sessionId);
        if (!session) return null;
        return { ...await preview(session),
          pendingRuns: await journal.pending(agentId, sessionId, session.messages) };
      } },
    replaceSession: { parse: parseReplace,
      invoke: async (_context, input) => {
        const item = input as { agentId: string; sessionId: string; session: Record<string, unknown>;
          expectedRevision: number; mode: SessionWriteMode };
        return preview(await sessions.replace({ ...item.session, agentId: item.agentId, id: item.sessionId },
          item.expectedRevision, item.mode));
      } },
    deleteSession: { parse: value => lookup(value, true),
      invoke: async (_context, input) => {
        const { agentId, sessionId } = input as { agentId: string; sessionId: string };
        await sessions.delete(agentId, sessionId);
        return { ok: true };
      } },
  };
}

function parsePreview(value: unknown) {
  const item = record(value);
  if (Object.keys(item).some(key => !['agentId', 'sessionId', 'model'].includes(key))
    || (item.model !== undefined && (typeof item.model !== 'string' || item.model.length > 500))) throw invalid();
  return { agentId: id(item.agentId), sessionId: id(item.sessionId), model: item.model };
}

function parseReplace(value: unknown) {
  const item = record(value);
  if (Object.keys(item).some(key => !['agentId', 'sessionId', 'session',
    'expectedRevision', 'mode'].includes(key))) throw invalid();
  if (!Number.isInteger(item.expectedRevision) ||
    !['content', 'rename', 'read'].includes(String(item.mode))) throw invalid();
  const session = record(item.session);
  if (item.mode === 'read' && (typeof session.lastReadAt !== 'string'
    || !Number.isFinite(Date.parse(session.lastReadAt)))) throw invalid();
  return { agentId: id(item.agentId), sessionId: id(item.sessionId),
    session, expectedRevision: item.expectedRevision as number,
    mode: item.mode };
}

function lookup(value: unknown, session: boolean) {
  const item = record(value);
  const allowed = session ? ['agentId', 'sessionId'] : ['agentId'];
  if (Object.keys(item).some(key => !allowed.includes(key))) throw invalid();
  return session ? { agentId: id(item.agentId), sessionId: id(item.sessionId) }
    : { agentId: id(item.agentId) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function invalid(): never {
  throw frameworkError({ code: 'MONSOON_SESSION_INPUT_INVALID', kind: 'validation',
    message: '季风会话参数无效', source: 'monsoon.sessions', retryable: false });
}
