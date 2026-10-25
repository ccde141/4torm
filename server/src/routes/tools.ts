/**
 * Tools + Skills 路由
 *
 * 注：permissions 端点已移除（危险工具二次确认机制废弃）。
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { executeTool, executeToolOutcome, getToolExecutionMode, ToolPermissionError } from '../services/tool-executor.js';
import type { ObservationScope } from '../services/execution-observation-contract.js';
import { executionObserver } from '../services/execution-observer.js';
import { executionLifecycle } from '../services/execution-lifecycle.js';
import { backgroundExecutions, type BackgroundExecutionSnapshot } from '../services/background-execution.js';
import { executionCapabilities } from '../services/builtin-execution-capabilities.js';
import { listToolCatalogWithDiagnostics, replaceCustomTools } from '../tools/custom-registry.js';
import { toolErrorFromUnknown } from '../engine/shared/tool-error.js';
import { frameworkErrorToHttp } from '../engine/shared/framework-error.js';
import { readAgentCollaborationCatalog } from '../engine/collaboration/agent-gateway.js';
import type { AgentToolDefinition } from '../engine/collaboration/contracts.js';
import type { ToolDefinition } from '../tools/tool-definition.js';
import { registerToolObservationRoutes } from './tool-observation-routes.js';

export interface ToolRouteOptions {
  executeTool?: typeof executeTool;
  /** 测试可缩短；生产默认给短命令 3 秒同步完成窗口。 */
  backgroundGraceMs?: number;
  collaborationTools?: () => AgentToolDefinition[];
}

export async function toolRoutes(app: FastifyInstance, options: ToolRouteOptions = {}): Promise<void> {
  const { dataDir } = getAppContext(app);
  const executeLocalTool = options.executeTool ?? executeTool;
  const executeLocalToolOutcome: typeof executeToolOutcome = options.executeTool
    ? async (...params: Parameters<typeof executeTool>) => ({
      result: await options.executeTool!(...params), ok: true,
    })
    : executeToolOutcome;
  const collaborationTools = options.collaborationTools ?? readAgentCollaborationCatalog;

  // 框架工具只读；data/tools/registry.json 仅承载用户自定义工具。
  app.get('/catalog', async () =>
    listToolCatalogWithDiagnostics(dataDir, collaborationTools().map(tool => ({
      ...tool, parameters: tool.parameters as ToolDefinition['parameters'],
    }))));

  app.put('/custom', async (req, reply) => {
    try {
      const body = req.body as { tools?: unknown } | undefined;
      const reserved = collaborationTools().map(tool => tool.name);
      const tools = await replaceCustomTools(dataDir, body?.tools, reserved);
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
            executionObserver.finish(trackedEntry.id, {
              status: 'cancelled', error: snapshot.error,
              errorCode: snapshot.errorCode, errorKind: snapshot.errorKind,
            });
          } else if (snapshot.status === 'failed') {
            executionObserver.finish(trackedEntry.id, {
              status: 'failed',
              error: snapshot.error,
              errorCode: snapshot.errorCode,
              errorKind: snapshot.errorKind,
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
            errorCode: background.errorCode,
            errorKind: background.errorKind,
            exitCode: background.exitCode,
            observationId: trackedEntry.id,
            executionId: trackedEntry.id,
          });
        }
        if (background.status === 'cancelled') {
          if (requestDisconnected) return;
          return reply.status(409).send({
            error: 'execution cancelled', errorCode: 'TOOL_EXECUTION_CANCELLED', errorKind: 'cancelled',
          });
        }
        return reply.send({
          result: background.result ?? '',
          meta,
          observationId: trackedEntry.id,
          executionId: trackedEntry.id,
        });
      }
      const outcome = await executeLocalToolOutcome(
        dataDir, tool, args || {}, agentId || '', workspaceDirOverride, sandboxLevelOverride,
        (m) => { meta = m; },
        controller.signal,
        undefined,
      );
      if (controller.signal.aborted) {
        return reply.status(409).send({
          error: 'execution cancelled', errorCode: 'TOOL_EXECUTION_CANCELLED', errorKind: 'cancelled',
        });
      }
      return reply.send({
        result: outcome.result, ...(outcome.ok ? {} : { ok: false }), meta,
        ...(outcome.toolImages?.length ? { toolImages: outcome.toolImages } : {}),
      });
    } catch (e) {
      const permissionFailure = e instanceof ToolPermissionError;
      const commandFailure = isCommandExecutionError(e) ? e : undefined;
      const failure = toolErrorFromUnknown(e, 'http.tools.exec');
      if (tracked) executionObserver.finish(tracked.id, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: (e as Error).message,
        errorCode: failure.data.code,
        errorKind: failure.data.kind,
        exitCode: commandFailure && typeof commandFailure.exitCode === 'number' ? commandFailure.exitCode : undefined,
      });
      if (permissionFailure) return reply.status(403).send({
        error: failure.message, errorCode: failure.data.code, errorKind: failure.data.kind,
      });
      if (requestDisconnected) return;
      if (controller.signal.aborted) return reply.status(409).send({
        error: 'execution cancelled', errorCode: 'TOOL_EXECUTION_CANCELLED', errorKind: 'cancelled',
      });
      // 子进程非零退出是命令的业务结果，不是 HTTP 服务故障。
      if (commandFailure) return reply.send({
        ok: false, error: commandFailure.message, exitCode: commandFailure.exitCode,
        errorCode: failure.data.code, errorKind: failure.data.kind, observationId: tracked?.id,
      });
      req.log.error(e);
      const mapped = frameworkErrorToHttp(failure);
      return reply.status(mapped.statusCode).send(mapped.body);
    } finally {
      if (!detached) releaseLifecycle?.();
      req.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', abort);
    }
  });

  registerToolObservationRoutes(app);
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
