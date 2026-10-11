import type { FastifyInstance } from 'fastify';
import { monsoonInputError } from '../application/input-service.js';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';

export function validateInputRunId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw monsoonInputError('INPUT_INVALID', 'validation', '执行标识无效');
  }
  return value;
}

export function registerConversationInput(
  app: FastifyInstance,
  router: CollaborationRouter,
): void {
  app.post('/input', async request => router.invoke({ feature: 'monsoon',
    method: 'submitInput', input: request.body }, humanContext(request)));
  app.get('/input', async request => router.invoke({ feature: 'monsoon',
    method: 'inspectInput', input: request.query }, humanContext(request)));
}
