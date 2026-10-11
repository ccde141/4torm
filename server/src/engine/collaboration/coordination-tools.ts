import { frameworkError } from '../shared/framework-error.js';
import {
  COLLABORATION_FEATURES,
  type AgentToolDefinition,
  type CollaborationContext,
  type CollaborationFeature,
} from './contracts.js';
import type { CollaborationRouter } from './router.js';
import { invokeRecordTool, isRecordTool, recordToolDefinitions } from './record-tools.js';

const definitions: AgentToolDefinition[] = [{
  name: 'inspect_operation',
  description: '按功能区、实体标识和运行标识精确读取一次持续执行的真实状态，避免拉取整个协作总览。',
  parameters: {
    type: 'object', additionalProperties: false,
    required: ['feature', 'operationId', 'runId'],
    properties: {
      feature: { type: 'string', enum: [...COLLABORATION_FEATURES] },
      operationId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' },
      runId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' },
    },
  },
}, {
  name: 'wait_operation',
  description: '等待一个持续执行发生状态变化；终态或需要介入时立即返回，超时则返回当前真实状态。',
  parameters: {
    type: 'object', additionalProperties: false,
    required: ['feature', 'operationId', 'runId'],
    properties: {
      feature: { type: 'string', enum: [...COLLABORATION_FEATURES] },
      operationId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' },
      runId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 60_000 },
    },
  },
}];

export function coordinationToolDefinitions(): AgentToolDefinition[] {
  return [...structuredClone(definitions), ...recordToolDefinitions()];
}

export function isCoordinationTool(name: string): boolean {
  return definitions.some(definition => definition.name === name) || isRecordTool(name);
}

export async function invokeCoordinationTool(
  router: CollaborationRouter,
  name: string,
  input: unknown,
  context: CollaborationContext,
): Promise<unknown> {
  if (isRecordTool(name)) return invokeRecordTool(router, name, input, context);
  if (name !== 'inspect_operation' && name !== 'wait_operation') throw unavailable();
  const parsed = parseIdentity(input);
  const scoped = {
    ...context, enabledFeatures: new Set([parsed.feature]),
  };
  if (name === 'inspect_operation') {
    const fact = await router.inspectOperation(parsed.feature, parsed, scoped);
    return { feature: parsed.feature, ...fact };
  }
  const result = await router.waitOperation(
    parsed.feature, parsed, scoped, parsed.timeoutMs ?? 30_000,
  );
  return { feature: parsed.feature, ...result.fact, timedOut: result.timedOut };
}

function parseIdentity(value: unknown): {
  feature: CollaborationFeature;
  operationId: string;
  runId: string;
  timeoutMs?: number;
} {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['feature', 'operationId', 'runId', 'timeoutMs'].includes(key))
    || !isFeature(value.feature)) throw invalidInput();
  const timeoutMs = parseTimeout(value.timeoutMs);
  return {
    feature: value.feature,
    operationId: identifier(value.operationId),
    runId: identifier(value.runId),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function parseTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || (parsed as number) < 1 || (parsed as number) > 60_000) {
    throw invalidInput();
  }
  return parsed as number;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function isFeature(value: unknown): value is CollaborationFeature {
  return typeof value === 'string'
    && (COLLABORATION_FEATURES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidInput() {
  return frameworkError({ code: 'COORDINATION_TOOL_INPUT_INVALID', kind: 'validation',
    message: '中心协作工具参数无效', source: 'collaboration.coordination', retryable: false });
}

function unavailable() {
  return frameworkError({ code: 'COORDINATION_TOOL_UNAVAILABLE', kind: 'not_found',
    message: '中心协作工具不存在', source: 'collaboration.coordination', retryable: false });
}
