import type { FastifyInstance } from 'fastify';
import type { ObservationScope } from '../services/execution-observation-contract.js';
import { executionObserver } from '../services/execution-observer.js';
import { executionLifecycle } from '../services/execution-lifecycle.js';
import { backgroundExecutions } from '../services/background-execution.js';
import { visualArtifactStore } from '../services/visual-artifact-store.js';
import { browserExecutionProducer } from '../services/browser-execution-producer.js';
import { normalizeBrowserEngine } from '../services/browser-engine.js';
import { executionCapabilities } from '../services/builtin-execution-capabilities.js';

export function registerToolObservationRoutes(app: FastifyInstance): void {
  registerObservationReads(app);
  registerBrowserOpenAndControl(app);
  registerSurfaceActions(app);
}

function registerObservationReads(app: FastifyInstance): void {
  app.get('/observations', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    if (!isScope(query.scope) || !query.ownerId) {
      return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    }
    return reply.send({ items: executionObserver.list(query.scope, query.ownerId).map(toSummary) });
  });

  app.get('/observations/:id', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isScope(query.scope) || !query.ownerId) {
      return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    }
    const item = executionObserver.getForOwner(id, query.scope, query.ownerId);
    return item ? reply.send({ item }) : reply.status(404).send({ error: 'observation not found' });
  });

  app.get('/observations/:id/frame', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isScope(query.scope) || !query.ownerId) {
      return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    }
    if (!executionObserver.getForOwner(id, query.scope, query.ownerId)) {
      return reply.status(404).send({ error: 'observation not found' });
    }
    const frame = visualArtifactStore.get(id);
    return frame
      ? reply.type(frame.mimeType).send(frame.data)
      : reply.status(404).send({ error: 'visual frame not available' });
  });

}

function registerBrowserOpenAndControl(app: FastifyInstance): void {
  app.post('/observations/browser', async (req, reply) => {
    const body = req.body as {
      scope?: string; ownerId?: string; surfaceId?: string; url?: string; engine?: unknown;
    };
    if (!isScope(body?.scope) || !body.ownerId || !body.url) {
      return reply.status(400).send({ error: 'missing browser scope, ownerId or url' });
    }
    const engine = normalizeBrowserEngine(body.engine);
    if (!engine) return reply.status(400).send({ error: 'unsupported browser engine' });
    try {
      const id = await browserExecutionProducer.open({
        scope: body.scope, ownerId: body.ownerId, surfaceId: body.surfaceId,
        url: body.url, engine,
      });
      return reply.send({ id });
    } catch (error) { return reply.status(500).send({ error: (error as Error).message }); }
  });

  app.post('/observations/:id/control', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const body = req.body as { control?: 'agent' | 'human' };
    const { id } = req.params as { id: string };
    if (!isScope(query.scope) || !query.ownerId || !body?.control) {
      return reply.status(400).send({ error: 'missing browser control context' });
    }
    try {
      const surface = requireSurface(id, query.scope, query.ownerId);
      if (!surface.control) {
        return reply.status(409).send({ error: 'execution surface does not support control transfer' });
      }
      await surface.control({ id, scope: query.scope, ownerId: query.ownerId }, body.control);
      return reply.status(204).send();
    } catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });

}

function registerSurfaceActions(app: FastifyInstance): void {
  app.post('/observations/:id/refresh', async (req, reply) => {
    const owner = observationOwner(req);
    if (!owner) return reply.status(400).send({ error: 'missing browser refresh context' });
    try {
      const surface = requireSurface(owner.id, owner.scope, owner.ownerId);
      if (!surface.refresh) return reply.status(409).send({ error: 'execution surface does not support refresh' });
      await surface.refresh(owner);
      const item = executionObserver.getForOwner(owner.id, owner.scope, owner.ownerId);
      return reply.send({ item: item ? toSummary(item) : undefined });
    } catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });

  app.post('/observations/:id/close', async (req, reply) => {
    const owner = observationOwner(req);
    if (!owner) return reply.status(400).send({ error: 'missing browser close context' });
    try {
      const surface = requireSurface(owner.id, owner.scope, owner.ownerId);
      if (!surface.close) return reply.status(409).send({ error: 'execution surface does not support close' });
      await surface.close(owner);
      return reply.status(204).send();
    } catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });

  app.post('/observations/:id/terminate', async (req, reply) => {
    const owner = observationOwner(req);
    if (!owner) return reply.status(400).send({ error: 'missing execution termination context' });
    const item = executionObserver.get(owner.id);
    if (!item || item.scope !== owner.scope || item.ownerId !== owner.ownerId) {
      return reply.status(404).send({ error: 'execution not found' });
    }
    if (item.status === 'cancelling') return reply.status(202).send({ status: 'cancelling' });
    const terminated = await executionLifecycle.terminate(owner.id, owner.scope, owner.ownerId)
      || await backgroundExecutions.terminate(owner.id, owner.scope, owner.ownerId);
    if (!terminated) return reply.status(409).send({ error: 'execution can no longer be terminated' });
    executionObserver.requestCancellation(owner.id);
    return reply.status(202).send({ status: 'cancelling' });
  });
}

function observationOwner(req: { query: unknown; params: unknown }) {
  const query = req.query as { scope?: string; ownerId?: string };
  const { id } = req.params as { id: string };
  return isScope(query.scope) && query.ownerId
    ? { id, scope: query.scope, ownerId: query.ownerId } : undefined;
}

function isScope(value: unknown): value is ObservationScope {
  return value === 'conversation' || value === 'cyclone';
}

function requireSurface(id: string, scope: ObservationScope, ownerId: string) {
  const item = executionObserver.getForOwner(id, scope, ownerId);
  if (!item) throw new Error('execution surface not found');
  return executionCapabilities.requireSurface(item.viewer);
}

function toSummary(item: ReturnType<typeof executionObserver.list>[number]) {
  const { id, surfaceId, kind, viewer, command, startedAt, finishedAt, status,
    exitCode, error, errorCode, errorKind, progress, outputTruncated } = item;
  return { id, surfaceId, kind, viewer, command, startedAt, finishedAt, status,
    exitCode, error, errorCode, errorKind, progress, outputTruncated,
    presentation: item.viewerState?.presentation };
}
