import type { FastifyInstance } from 'fastify';

import { execTaskBoard } from '../engine/shared/taskboard.js';
import { getAppContext } from '../services/app-context.js';
import { resolveSafePath } from '../utils/path-guard.js';

interface MutationBody {
  path?: unknown;
  action?: unknown;
  expectedRevision?: unknown;
  goal?: unknown;
  tasks?: unknown;
}

function resolveTaskboardPath(dataDir: string, value: unknown): string {
  if (typeof value !== 'string' || !value.endsWith('.taskboard.json')) {
    throw Object.assign(new Error('任务板路径必须以 .taskboard.json 结尾'), { statusCode: 400 });
  }
  return resolveSafePath(dataDir, value);
}

export async function taskboardRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);
  app.post('/mutate', async (request, reply) => {
    const body = request.body as MutationBody | null;
    const file = resolveTaskboardPath(dataDir, body?.path);
    const execution = await execTaskBoard(file, {
      action: body?.action,
      expectedRevision: body?.expectedRevision,
      goal: body?.goal,
      tasks: body?.tasks,
    });
    if (execution.conflict) return reply.status(409).send(execution);
    if (execution.errorCode) return reply.status(500).send(execution);
    if (!execution.ok) return reply.status(400).send(execution);
    return reply.send(execution);
  });
}
