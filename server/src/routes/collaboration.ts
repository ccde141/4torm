import type { FastifyInstance } from 'fastify';
import {
  COLLABORATION_FEATURES,
  type CollaborationFeature,
  type ModuleCall,
  type ObservationQueryInput,
  type OutputBudgetRequest,
} from '../engine/collaboration/contracts.js';
import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { probeCatalog } from '../shared/probes/public.js';
import { humanContext } from './collaboration-context.js';
import { registerCollaborationRecordRoutes } from './collaboration-records.js';

export interface CollaborationRouteOptions {
  router: CollaborationRouter;
}

export async function collaborationRoutes(
  app: FastifyInstance,
  options: CollaborationRouteOptions,
): Promise<void> {
  const pendingInvocations = new Set<AbortController>();
  app.addHook('preClose', async () => {
    for (const controller of pendingInvocations) controller.abort(new Error('服务正在关闭'));
  });
  registerCollaborationRecordRoutes(app, options.router);
  app.get('/probe-fields', async () => probeCatalog('human'));
  app.get('/presence', async request => options.router.agentPresence(humanContext(request)));
  app.get('/modules', async (request, reply) => {
    return reply.send(options.router.listManifests(humanContext(request)));
  });

  app.post('/invoke', async (request, reply) => {
    const call = parseCall(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('客户端已中止请求'));
    const close = () => { if (!reply.raw.writableEnded) abort(); };
    pendingInvocations.add(controller);
    request.raw.once('aborted', abort);
    reply.raw.once('close', close);
    try {
      const result = await options.router.invoke(call, { ...humanContext(request), signal: controller.signal });
      return reply.send(result);
    } finally {
      pendingInvocations.delete(controller);
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', close);
    }
  });

  app.post('/observe', async (request, reply) => {
    const call = parseObservationCall(request.body);
    const result = await options.router.observe(call.feature, call.query, humanContext(request));
    return reply.send(result);
  });

  app.post('/snapshot', async (request, reply) => {
    const query = parseSnapshot(request.body);
    return reply.send(await options.router.snapshot(query, humanContext(request)));
  });

  app.post('/operation', async (request, reply) => {
    const identity = parseOperation(request.body);
    const fact = await options.router.inspectOperation(
      identity.feature, identity, humanContext(request),
    );
    return reply.send({ feature: identity.feature, ...fact });
  });

  app.post('/operation/wait', async (request, reply) => {
    const input = parseOperationWait(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('客户端已断开运行等待'));
    request.raw.once('aborted', abort);
    try {
      const result = await options.router.waitOperation(
        input.feature, input,
        { ...humanContext(request), signal: controller.signal }, input.timeoutMs,
      );
      return reply.send({ feature: input.feature, ...result.fact, timedOut: result.timedOut });
    } finally {
      request.raw.removeListener('aborted', abort);
    }
  });
}

function parseOperationWait(value: unknown): {
  feature: CollaborationFeature;
  operationId: string;
  runId: string;
  timeoutMs: number;
} {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['feature', 'operationId', 'runId', 'timeoutMs'].includes(key))
    || !isFeature(value.feature)) throw invalidOperation();
  const timeoutMs = value.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 60_000) {
    throw invalidOperation();
  }
  return {
    feature: value.feature, operationId: operationIdentifier(value.operationId),
    runId: operationIdentifier(value.runId), timeoutMs: timeoutMs as number,
  };
}

function parseOperation(value: unknown): {
  feature: CollaborationFeature;
  operationId: string;
  runId: string;
} {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['feature', 'operationId', 'runId'].includes(key))
    || !isFeature(value.feature)) throw invalidOperation();
  return {
    feature: value.feature,
    operationId: operationIdentifier(value.operationId),
    runId: operationIdentifier(value.runId),
  };
}

function parseSnapshot(value: unknown): ObservationQueryInput {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'query') || !isRecord(value.query)) {
    throw invalidObservation();
  }
  return parseQuery(value.query, false);
}

function parseObservationCall(value: unknown): {
  feature: CollaborationFeature;
  query: ObservationQueryInput;
} {
  if (!isRecord(value)) throw invalidObservation();
  if (Object.keys(value).some(key => key !== 'feature' && key !== 'query')) throw invalidObservation();
  if (!isFeature(value.feature) || !isRecord(value.query)) throw invalidObservation();
  return { feature: value.feature, query: parseQuery(value.query, true) };
}

function parseQuery(value: Record<string, unknown>, allowCursor: boolean): ObservationQueryInput {
  const allowed = new Set([
    'view', 'limit', 'eventLimit', 'maxTextChars', 'maxTextLines', 'fields',
    ...(allowCursor ? ['cursor'] : []),
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalidObservation();
  return value as ObservationQueryInput;
}

function parseCall(value: unknown): ModuleCall {
  if (!isRecord(value)) throw invalidCall();
  const allowed = new Set(['feature', 'method', 'input', 'budget']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalidCall();
  if (!isFeature(value.feature) || !isNonEmptyString(value.method)) throw invalidCall();
  return {
    feature: value.feature,
    method: value.method,
    input: value.input ?? {},
    budget: parseBudget(value.budget),
  };
}

function parseBudget(value: unknown): OutputBudgetRequest | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalidCall();
  const allowed = new Set(['items', 'events', 'textChars', 'textLines']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalidCall();
  return value as OutputBudgetRequest;
}

function invalidCall() {
  return frameworkError({
    code: 'COLLABORATION_CALL_INVALID', kind: 'validation',
    message: '协作调用参数无效', source: 'collaboration.http', retryable: false,
  });
}

function invalidObservation() {
  return frameworkError({
    code: 'COLLABORATION_OBSERVATION_INVALID', kind: 'validation',
    message: '状态观察参数无效', source: 'collaboration.http', retryable: false,
  });
}

function invalidOperation() {
  return frameworkError({
    code: 'COLLABORATION_OPERATION_INVALID', kind: 'validation',
    message: '运行句柄参数无效', source: 'collaboration.http', retryable: false,
  });
}

function operationIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidOperation();
  }
  return value;
}

function isFeature(value: unknown): value is CollaborationFeature {
  return typeof value === 'string'
    && (COLLABORATION_FEATURES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
