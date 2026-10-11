import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../../../services/app-context.js';
import {
  AgentValidationError, assertAgentId, parseAgentConfig, parseAgentPatch, parseCreateAgent,
} from '../domain/agent.js';
import { AgentRepository } from '../infrastructure/repository.js';
import { agentWorkspaceDisplayPath } from '../../../services/data-paths.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir, projectRoot } = getAppContext(app);
  const repository = new AgentRepository(dataDir);

  app.get('/', async (_request, reply) => reply.send((await repository.list()).map(agent => ({
    ...agent,
    workspaceDisplayPath: agentWorkspaceDisplayPath(
      projectRoot, dataDir, agent.id, agent.config.workspace,
    ),
  }))));

  app.post('/', async (request, reply) => {
    try {
      return reply.status(201).send(await repository.create(parseCreateAgent(request.body)));
    } catch (error) {
      return agentError(reply, error);
    }
  });

  app.patch('/:agentId', async (request, reply) => {
    try {
      const id = assertAgentId((request.params as { agentId?: unknown }).agentId);
      return reply.send(await repository.update(id, parseAgentPatch(request.body)));
    } catch (error) {
      return agentError(reply, error);
    }
  });

  app.put('/:agentId/config', async (request, reply) => {
    try {
      const id = assertAgentId((request.params as { agentId?: unknown }).agentId);
      const body = record(request.body);
      const config = parseAgentConfig(body.config);
      const model = typeof body.model === 'string' ? body.model : '';
      const patch = parseAgentPatch(body.patch ?? {});
      return reply.send(await repository.updateConfig(id, config, model, patch));
    } catch (error) {
      return agentError(reply, error);
    }
  });

  app.delete('/:agentId', async (request, reply) => {
    try {
      const id = assertAgentId((request.params as { agentId?: unknown }).agentId);
      const existed = await repository.delete(id);
      return reply.send({ ok: true, existed });
    } catch (error) {
      return agentError(reply, error);
    }
  });
}

function agentError(reply: { status(code: number): { send(value: unknown): unknown } }, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Agent 不存在') return reply.status(404).send({ error: message });
  if (error instanceof AgentValidationError) return reply.status(400).send({ error: message });
  throw error;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentValidationError('Agent 更新参数无效');
  }
  return value as Record<string, unknown>;
}
