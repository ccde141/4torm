/**
 * Tools + Skills 路由
 *
 * 迁移自 vite.config.ts 的 tool-executor / skills-api。
 * 注：permissions 端点已移除（危险工具二次确认机制废弃）。
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { executeTool, getToolExecutionMode, ToolPermissionError } from '../services/tool-executor.js';
import type { ObservationScope } from '../services/execution-observation-contract.js';
import { executionObserver } from '../services/execution-observer.js';
import { executionLifecycle } from '../services/execution-lifecycle.js';
import { backgroundExecutions, type BackgroundExecutionSnapshot } from '../services/background-execution.js';
import { visualArtifactStore } from '../services/visual-artifact-store.js';
import { browserExecutionProducer } from '../services/browser-execution-producer.js';
import { normalizeBrowserEngine } from '../services/browser-engine.js';
import { executionCapabilities } from '../services/builtin-execution-capabilities.js';
import { listToolCatalog, replaceCustomTools } from '../tools/custom-registry.js';

export interface ToolRouteOptions {
  executeTool?: typeof executeTool;
  /** 测试可缩短；生产默认给短命令 3 秒同步完成窗口。 */
  backgroundGraceMs?: number;
}

export async function toolRoutes(app: FastifyInstance, options: ToolRouteOptions = {}): Promise<void> {
  const { dataDir } = getAppContext(app);
  const executeLocalTool = options.executeTool ?? executeTool;

  // 框架工具只读；data/tools/registry.json 仅承载用户自定义工具。
  app.get('/catalog', async () => ({ tools: await listToolCatalog(dataDir) }));

  app.put('/custom', async (req, reply) => {
    try {
      const body = req.body as { tools?: unknown } | undefined;
      const tools = await replaceCustomTools(dataDir, body?.tools);
      return reply.send({ tools });
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

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
    let detached = false;
    let releaseLifecycle: (() => void) | undefined;
    let backgroundOwner: { id: string; scope: ObservationScope; ownerId: string } | undefined;
    const abort = () => {
      requestDisconnected = true;
      if (detached) return;
      controller.abort();
      if (backgroundOwner) {
        void backgroundExecutions.terminate(backgroundOwner.id, backgroundOwner.scope, backgroundOwner.ownerId);
      }
    };
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
      const executionMode = await getToolExecutionMode(dataDir, tool);
      tracked = executionMode === 'detachable' && isObservationScope(observation?.scope) && typeof observation?.ownerId === 'string'
        ? executionObserver.start({
            scope: observation.scope,
            ownerId: observation.ownerId,
            command: tool === 'run_command' ? String(args?.command || args?.cmd || '') : tool,
            kind: 'terminal',
            viewer: 'terminal',
          })
        : undefined;
      if (tracked) {
        const trackedEntry = tracked;
        const ownedObservation = { scope: trackedEntry.scope, ownerId: trackedEntry.ownerId };
        backgroundOwner = { id: trackedEntry.id, ...ownedObservation };
        releaseLifecycle = executionLifecycle.register(trackedEntry, async () => {
          await backgroundExecutions.terminate(trackedEntry.id, ownedObservation.scope, ownedObservation.ownerId);
        });

        const finishObservation = (snapshot: BackgroundExecutionSnapshot) => {
          if (snapshot.status === 'completed') {
            executionObserver.finish(trackedEntry.id, { status: 'completed', exitCode: 0 });
          } else if (snapshot.status === 'cancelled') {
            executionObserver.finish(trackedEntry.id, { status: 'cancelled', error: snapshot.error });
          } else if (snapshot.status === 'failed') {
            executionObserver.finish(trackedEntry.id, {
              status: 'failed',
              error: snapshot.error,
              exitCode: typeof snapshot.exitCode === 'number' ? snapshot.exitCode : undefined,
            });
          }
          releaseLifecycle?.();
          releaseLifecycle = undefined;
        };

        const background = await backgroundExecutions.start({
          executionId: trackedEntry.id,
          scope: ownedObservation.scope,
          ownerId: ownedObservation.ownerId,
          label: trackedEntry.command,
          graceMs: options.backgroundGraceMs ?? 3_000,
          run: signal => executeLocalTool(
            dataDir,
            tool,
            args || {},
            agentId || '',
            workspaceDirOverride,
            sandboxLevelOverride,
            (m) => { meta = m; },
            signal,
            (stream, text) => executionObserver.append(trackedEntry.id, stream, text),
          ),
          onSettled: finishObservation,
        });

        if (background.status === 'running' || background.status === 'cancelling') {
          executionObserver.promote(trackedEntry.id);
          detached = true;
          backgroundOwner = undefined;
          return reply.send({
            result: formatBackgroundResult(background),
            meta,
            observationId: trackedEntry.id,
            executionId: trackedEntry.id,
          });
        }
        if (background.status === 'failed') {
          return reply.send({
            ok: false,
            error: background.error,
            exitCode: background.exitCode,
            observationId: trackedEntry.id,
            executionId: trackedEntry.id,
          });
        }
        if (background.status === 'cancelled') {
          if (requestDisconnected) return;
          return reply.status(409).send({ error: 'execution cancelled' });
        }
        return reply.send({
          result: background.result ?? '',
          meta,
          observationId: trackedEntry.id,
          executionId: trackedEntry.id,
        });
      }
      const result = await executeLocalTool(
        dataDir, tool, args || {}, agentId || '', workspaceDirOverride, sandboxLevelOverride,
        (m) => { meta = m; },
        controller.signal,
        undefined,
      );
      if (controller.signal.aborted) {
        return reply.status(409).send({ error: 'execution cancelled' });
      }
      return reply.send({ result, meta });
    } catch (e) {
      const permissionFailure = e instanceof ToolPermissionError;
      const commandFailure = isCommandExecutionError(e) ? e : undefined;
      if (tracked) executionObserver.finish(tracked.id, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: (e as Error).message,
        exitCode: commandFailure && typeof commandFailure.exitCode === 'number' ? commandFailure.exitCode : undefined,
      });
      if (permissionFailure) return reply.status(403).send({ error: (e as Error).message });
      if (requestDisconnected) return;
      if (controller.signal.aborted) return reply.status(409).send({ error: 'execution cancelled' });
      // 子进程非零退出是命令的业务结果，不是 HTTP 服务故障。
      if (commandFailure) return reply.send({ ok: false, error: commandFailure.message, exitCode: commandFailure.exitCode, observationId: tracked?.id });
      return reply.status(500).send({ error: (e as Error).message });
    } finally {
      if (!detached) releaseLifecycle?.();
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
    const terminated = await executionLifecycle.terminate(id, query.scope, query.ownerId)
      || await backgroundExecutions.terminate(id, query.scope, query.ownerId);
    if (!terminated) return reply.status(409).send({ error: 'execution can no longer be terminated' });
    executionObserver.requestCancellation(id);
    return reply.status(202).send({ status: 'cancelling' });
  });
}

function formatBackgroundResult(snapshot: BackgroundExecutionSnapshot): string {
  return [
    '工具已启动，当前仍在后台运行。',
    `executionId: ${snapshot.executionId}`,
    '可使用 inspect_execution 查看状态、wait_execution 有限等待，或 terminate_execution 终止。',
  ].join('\n');
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
