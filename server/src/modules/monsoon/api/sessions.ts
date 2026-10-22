import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SessionRevisionConflictError } from '../infrastructure/session-repository.js';
import type { SessionWriteMode } from '../domain/session.js';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { humanContext } from '../../../routes/collaboration-context.js';

export function registerMonsoonSessions(
  app: FastifyInstance,
  router: CollaborationRouter,
): void {
  app.post('/sessions', async (request, reply) => {
    try { return reply.status(201).send(await invoke(router, 'createSession', request.body, request)); }
    catch (error) { return sendError(reply, error); }
  });

  app.get('/sessions/:agentId', async (request, reply) => {
    try {
      const { agentId } = identifiers(request.params, ['agentId']);
      return reply.send(await invoke(router, 'listSessions', { agentId }, request));
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/sessions/:agentId/:sessionId', async (request, reply) => {
    try {
      const { agentId, sessionId } = identifiers(request.params, ['agentId', 'sessionId']);
      const session = await invoke(router, 'readSession', { agentId, sessionId }, request);
      if (!session) return reply.status(404).send({ error: '会话不存在' });
      return reply.send(session);
    } catch (error) { return sendError(reply, error); }
  });

  app.put('/sessions/:agentId/:sessionId', async (request, reply) => {
    try {
      const { agentId, sessionId } = identifiers(request.params, ['agentId', 'sessionId']);
      const body = writeBody(request.body);
      return reply.send(await invoke(router, 'replaceSession',
        { agentId, sessionId, ...body }, request));
    } catch (error) { return sendError(reply, error); }
  });

  app.delete('/sessions/:agentId/:sessionId', async (request, reply) => {
    try {
      const { agentId, sessionId } = identifiers(request.params, ['agentId', 'sessionId']);
      return reply.send(await invoke(router, 'deleteSession', { agentId, sessionId }, request));
    } catch (error) { return sendError(reply, error); }
  });
}

function invoke(router: CollaborationRouter, method: string, input: unknown, request: FastifyRequest) {
  return router.invoke({ feature: 'monsoon', method, input }, humanContext(request));
}

function writeBody(value: unknown): {
  expectedRevision: number;
  mode: SessionWriteMode;
  session: unknown;
} {
  if (!record(value) || !Number.isInteger(value.expectedRevision)
    || !['content', 'rename', 'read'].includes(String(value.mode)) || !record(value.session)) {
    throw new Error('会话写入参数无效');
  }
  return {
    expectedRevision: Number(value.expectedRevision),
    mode: value.mode as SessionWriteMode,
    session: value.session,
  };
}

function identifiers(value: unknown, fields: string[]): Record<string, string> {
  if (!record(value)) throw new Error('会话路径无效');
  const result: Record<string, string> = {};
  for (const field of fields) {
    const item = value[field];
    if (typeof item !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item)) {
      throw new Error('会话路径无效');
    }
    result[field] = item;
  }
  return result;
}

function sendError(reply: { status(code: number): { send(value: unknown): unknown } }, error: unknown) {
  if (error instanceof FrameworkError) throw error;
  if (error instanceof SessionRevisionConflictError) {
    return reply.status(409).send({ error: error.message, current: error.current });
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = message === '会话不存在' ? 404 : message === '会话已经存在' ? 409 : 400;
  return reply.status(status).send({ error: message });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
