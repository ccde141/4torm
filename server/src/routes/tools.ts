/**
 * Tools + Skills 路由
 *
 * 迁移自 vite.config.ts 的 tool-executor / skills-api。
 * 注：permissions 端点已移除（危险工具二次确认机制废弃）。
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { executeTool } from '../services/tool-executor.js';
import type { ObservationScope } from '../services/execution-observation-contract.js';
import { executionObserver } from '../services/execution-observer.js';
import { executionLifecycle } from '../services/execution-lifecycle.js';
import { visualArtifactStore } from '../services/visual-artifact-store.js';
import { browserExecutionProducer } from '../services/browser-execution-producer.js';
import { normalizeBrowserEngine } from '../services/browser-engine.js';
import { executionCapabilities } from '../services/builtin-execution-capabilities.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // POST /api/tools/exec
  app.post('/exec', async (req, reply) => {
    const body = req.body as any;
    if (!body || !body.tool) {
      return reply.status(400).send({ error: '缺少 tool 参数' });
    }
    const { tool, args, agentId, workspaceDirOverride, sandboxLevelOverride, observation } = body;
    const controller = new AbortController();
    let tracked: ReturnType<typeof executionObserver.start> | undefined;
    let requestDisconnected = false;
    let releaseLifecycle: (() => void) | undefined;
    const abort = () => { requestDisconnected = true; controller.abort(); };
    req.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      const capabilityTool = executionCapabilities.findTool(tool);
      if (capabilityTool) {
        const ownedObservation = isObservationScope(observation?.scope) && typeof observation?.ownerId === 'string'
          ? { scope: observation.scope, ownerId: observation.ownerId }
          : undefined;
        return reply.send({ result: await capabilityTool.execute({ dataDir, agentId: agentId || '', args: args || {}, observation: ownedObservation, signal: controller.signal }) });
      }
      let meta: unknown;
      tracked = tool === 'run_command' && isObservationScope(observation?.scope) && typeof observation?.ownerId === 'string'
        ? executionObserver.start({ scope: observation.scope, ownerId: observation.ownerId, command: String(args?.command || args?.cmd || ''), kind: 'terminal', viewer: 'terminal' })
        : undefined;
      if (tracked) releaseLifecycle = executionLifecycle.register(tracked, () => controller.abort());
      const result = await executeTool(
        dataDir, tool, args || {}, agentId || '', workspaceDirOverride, sandboxLevelOverride,
        (m) => { meta = m; },
        controller.signal,
        (stream, text) => { if (tracked) executionObserver.append(tracked.id, stream, text); },
      );
      if (controller.signal.aborted) {
        if (tracked) executionObserver.finish(tracked.id, { status: 'cancelled' });
        return reply.status(409).send({ error: 'execution cancelled' });
      }
      if (tracked) executionObserver.finish(tracked.id, { status: 'completed', exitCode: 0 });
      return reply.send({ result, meta, observationId: tracked?.id });
    } catch (e) {
      const commandFailure = isCommandExecutionError(e) ? e : undefined;
      if (tracked) executionObserver.finish(tracked.id, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: (e as Error).message,
        exitCode: commandFailure && typeof commandFailure.exitCode === 'number' ? commandFailure.exitCode : undefined,
      });
      if (requestDisconnected) return;
      if (controller.signal.aborted) return reply.status(409).send({ error: 'execution cancelled' });
      // 子进程非零退出是命令的业务结果，不是 HTTP 服务故障。
      if (commandFailure) return reply.send({ ok: false, error: commandFailure.message, exitCode: commandFailure.exitCode, observationId: tracked?.id });
      return reply.status(500).send({ error: (e as Error).message });
    } finally {
      releaseLifecycle?.();
      req.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', abort);
    }
  });

  app.get('/observations', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    return reply.send({ items: executionObserver.list(query.scope, query.ownerId).map(toObservationSummary) });
  });

  app.get('/observations/:id', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    const item = executionObserver.getForOwner(id, query.scope, query.ownerId);
    if (!item) return reply.status(404).send({ error: 'observation not found' });
    return reply.send({ item });
  });

  app.get('/observations/:id/frame', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing observation scope or ownerId' });
    if (!executionObserver.getForOwner(id, query.scope, query.ownerId)) return reply.status(404).send({ error: 'observation not found' });
    const frame = visualArtifactStore.get(id);
    if (!frame) return reply.status(404).send({ error: 'visual frame not available' });
    return reply.type(frame.mimeType).send(frame.data);
  });

  app.post('/observations/browser', async (req, reply) => {
    const body = req.body as { scope?: string; ownerId?: string; surfaceId?: string; url?: string; engine?: unknown };
    if (!isObservationScope(body?.scope) || !body.ownerId || !body.url) return reply.status(400).send({ error: 'missing browser scope, ownerId or url' });
    const engine = normalizeBrowserEngine(body.engine);
    if (!engine) return reply.status(400).send({ error: 'unsupported browser engine' });
    try { return reply.send({ id: await browserExecutionProducer.open({ scope: body.scope, ownerId: body.ownerId, surfaceId: body.surfaceId, url: body.url, engine }) }); }
    catch (error) { return reply.status(500).send({ error: (error as Error).message }); }
  });

  app.post('/observations/:id/control', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const body = req.body as { control?: 'agent' | 'human' };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId || !body?.control) return reply.status(400).send({ error: 'missing browser control context' });
    try {
      const surface = requireOwnedSurface(id, query.scope, query.ownerId);
      if (!surface.control) return reply.status(409).send({ error: 'execution surface does not support control transfer' });
      await surface.control({ id, scope: query.scope, ownerId: query.ownerId }, body.control);
      return reply.status(204).send();
    } catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });

  app.post('/observations/:id/refresh', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing browser refresh context' });
    try {
      const surface = requireOwnedSurface(id, query.scope, query.ownerId);
      if (!surface.refresh) return reply.status(409).send({ error: 'execution surface does not support refresh' });
      await surface.refresh({ id, scope: query.scope, ownerId: query.ownerId });
      const item = executionObserver.getForOwner(id, query.scope, query.ownerId);
      return reply.send({ item: item ? toObservationSummary(item) : undefined });
    } catch (error) {
      return reply.status(404).send({ error: (error as Error).message });
    }
  });

  app.post('/observations/:id/close', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing browser close context' });
    try {
      const surface = requireOwnedSurface(id, query.scope, query.ownerId);
      if (!surface.close) return reply.status(409).send({ error: 'execution surface does not support close' });
      await surface.close({ id, scope: query.scope, ownerId: query.ownerId });
      return reply.status(204).send();
    } catch (error) {
      return reply.status(404).send({ error: (error as Error).message });
    }
  });

  app.post('/observations/:id/terminate', async (req, reply) => {
    const query = req.query as { scope?: string; ownerId?: string };
    const { id } = req.params as { id: string };
    if (!isObservationScope(query.scope) || !query.ownerId) return reply.status(400).send({ error: 'missing execution termination context' });
    const item = executionObserver.get(id);
    if (!item || item.scope !== query.scope || item.ownerId !== query.ownerId) return reply.status(404).send({ error: 'execution not found' });
    if (item.status === 'cancelling') return reply.status(202).send({ status: 'cancelling' });
    const terminated = await executionLifecycle.terminate(id, query.scope, query.ownerId);
    if (!terminated) return reply.status(409).send({ error: 'execution can no longer be terminated' });
    executionObserver.requestCancellation(id);
    return reply.status(202).send({ status: 'cancelling' });
  });
}

function isCommandExecutionError(error: unknown): error is Error & { exitCode: number | null } {
  return error instanceof Error
    && error.name === 'CommandExecutionError'
    && ('exitCode' in error)
    && (typeof error.exitCode === 'number' || error.exitCode === null);
}

function isObservationScope(value: unknown): value is ObservationScope {
  return value === 'conversation' || value === 'cyclone';
}

function requireOwnedSurface(id: string, scope: ObservationScope, ownerId: string) {
  const item = executionObserver.getForOwner(id, scope, ownerId);
  if (!item) throw new Error('execution surface not found');
  return executionCapabilities.requireSurface(item.viewer);
}

function toObservationSummary(item: ReturnType<typeof executionObserver.list>[number]) {
  return {
    id: item.id,
    surfaceId: item.surfaceId,
    kind: item.kind,
    viewer: item.viewer,
    command: item.command,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    status: item.status,
    exitCode: item.exitCode,
    error: item.error,
    progress: item.progress,
    outputTruncated: item.outputTruncated,
    presentation: item.viewerState?.presentation,
  };
}
