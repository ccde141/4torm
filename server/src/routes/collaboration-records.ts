import type { FastifyInstance } from 'fastify';
import {
  COLLABORATION_FEATURES, type CollaborationFeature,
} from '../engine/collaboration/contracts.js';
import type { CollaborationRouter } from '../engine/collaboration/router.js';
import type { RecordListInput, RecordReadInput } from '../engine/collaboration/record-router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { humanContext } from './collaboration-context.js';

export function registerCollaborationRecordRoutes(
  app: FastifyInstance, router: CollaborationRouter,
): void {
  app.post('/records/find', async (request, reply) => {
    const { feature, input } = parseFind(request.body);
    return reply.send(await router.listOperationRecords(feature, input,
      humanContext(request)));
  });
  app.post('/records/read', async (request, reply) => {
    const { feature, operationId, runId, input } = parseRead(request.body);
    return reply.send(await router.readOperationRecord(feature, { operationId, runId }, input,
      humanContext(request)));
  });
  app.post('/records/agents/latest', async (request, reply) => {
    const body = parsed(request.body, ['agentIds']);
    if (!Array.isArray(body.agentIds)) throw invalid();
    return reply.send(await router.latestAgentRecords(body.agentIds,
      humanContext(request)));
  });
}

function parseFind(value: unknown): { feature: CollaborationFeature; input: RecordListInput } {
  const raw = parsed(value, ['feature', 'operationId', 'agentId',
    'since', 'until', 'limit', 'cursor']);
  return { feature: feature(raw.feature), input: {
    ...optionalText(raw, 'operationId'), ...optionalText(raw, 'agentId'),
    ...optionalText(raw, 'since'),
    ...optionalText(raw, 'until'), ...optionalText(raw, 'cursor'),
    ...optionalNumber(raw, 'limit'),
  } };
}

function parseRead(value: unknown): {
  feature: CollaborationFeature; operationId: string; runId: string; input: RecordReadInput;
} {
  const raw = parsed(value, [
    'feature', 'operationId', 'runId', 'maxTextChars', 'maxTextLines', 'cursor',
  ]);
  return { feature: feature(raw.feature), operationId: requiredText(raw.operationId),
    runId: requiredText(raw.runId), input: {
      ...optionalText(raw, 'cursor'), ...optionalNumber(raw, 'maxTextChars'),
      ...optionalNumber(raw, 'maxTextLines'),
    } };
}

function parsed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

function feature(value: unknown): CollaborationFeature {
  if (typeof value !== 'string'
    || !(COLLABORATION_FEATURES as readonly string[]).includes(value)) throw invalid();
  return value as CollaborationFeature;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value) throw invalid();
  return value;
}

function optionalText<K extends 'operationId' | 'agentId' | 'since' | 'until' | 'cursor'>(
  raw: Record<string, unknown>, key: K,
): Partial<Record<K, string>> {
  if (raw[key] === undefined) return {};
  if (typeof raw[key] !== 'string') throw invalid();
  return { [key]: raw[key] } as Partial<Record<K, string>>;
}

function optionalNumber<K extends 'limit' | 'maxTextChars' | 'maxTextLines'>(
  raw: Record<string, unknown>, key: K,
): Partial<Record<K, number>> {
  if (raw[key] === undefined) return {};
  if (typeof raw[key] !== 'number' || !Number.isInteger(raw[key])) throw invalid();
  return { [key]: raw[key] } as Partial<Record<K, number>>;
}

function invalid() {
  return frameworkError({ code: 'COLLABORATION_RECORD_INPUT_INVALID', kind: 'validation',
    message: '运行记录请求参数无效', source: 'collaboration.http', retryable: false });
}
