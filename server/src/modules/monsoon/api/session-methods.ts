import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import type { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import type { SessionWriteMode } from '../domain/session.js';

export interface MonsoonSessionPorts {
  sessions: FileMonsoonSessionRepository;
  journal: FileMonsoonTurnJournal;
}

export function monsoonSessionManifests(): ModuleMethodManifest[] {
  const names = [
    ['createSession', 'design'], ['listSessions', 'observe'], ['readSession', 'observe'],
    ['replaceSession', 'design'], ['deleteSession', 'administer'],
  ] as const;
  return names.map(([id, permission]) => ({ id,
    kind: permission === 'observe' ? 'query' : 'command', permission,
    audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' },
  }));
}

export function monsoonSessionHandlers(ports: MonsoonSessionPorts): Record<string, ModuleMethodHandler> {
  const { sessions, journal } = ports;
  return {
    createSession: { parse: value => record(value),
      invoke: (_context, input) => sessions.create(input) },
    listSessions: { parse: value => lookup(value, false),
      invoke: (_context, input) => sessions.list((input as { agentId: string }).agentId) },
    readSession: { parse: value => lookup(value, true),
      invoke: async (_context, input) => {
        const { agentId, sessionId } = input as { agentId: string; sessionId: string };
        const session = await sessions.get(agentId, sessionId);
        if (!session) return null;
        return { ...session,
          pendingRuns: await journal.pending(agentId, sessionId, session.messages) };
      } },
    replaceSession: { parse: parseReplace,
      invoke: (_context, input) => {
        const item = input as { agentId: string; sessionId: string; session: Record<string, unknown>;
          expectedRevision: number; mode: SessionWriteMode };
        return sessions.replace({ ...item.session, agentId: item.agentId, id: item.sessionId },
          item.expectedRevision, item.mode);
      } },
    deleteSession: { parse: value => lookup(value, true),
      invoke: async (_context, input) => {
        const { agentId, sessionId } = input as { agentId: string; sessionId: string };
        await sessions.delete(agentId, sessionId);
        return { ok: true };
      } },
  };
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
