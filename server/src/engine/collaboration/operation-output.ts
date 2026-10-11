import { FrameworkError, frameworkError } from '../shared/framework-error.js';
import type {
  CollaborationFeature,
  FeatureOperationHandler,
  OperationIdentity,
} from './contracts.js';
import { ProbeContractError, validateProbe, type ProbeItem } from '../../shared/probes/public.js';

export async function verifiedOperationOutput(
  value: unknown,
  operations: FeatureOperationHandler,
  feature: CollaborationFeature,
  method: string,
): Promise<unknown> {
  const identity = operationIdentity(value, feature, method);
  const fact = await inspectOperationFact(operations, feature, method, identity);
  if (!fact) {
    throw operationError(
      'FEATURE_OPERATION_NOT_OBSERVABLE',
      '功能运行尚未进入可观察状态',
      feature,
      method,
      identity,
    );
  }
  return value;
}

export async function inspectOperationFact(
  operations: FeatureOperationHandler,
  feature: CollaborationFeature,
  method: string,
  identity: OperationIdentity,
): Promise<ProbeItem | null> {
  let fact: ProbeItem | null;
  try {
    fact = await operations.inspect(identity);
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    throw operationError(
      'FEATURE_OPERATION_LOOKUP_FAILED',
      '无法确认功能运行是否已经登记',
      feature,
      method,
      identity,
      error,
    );
  }
  if (!fact) return null;
  try {
    validateProbe(fact);
  } catch (error) {
    if (!(error instanceof ProbeContractError)) throw error;
    throw operationError(
      'FEATURE_OPERATION_FACT_INVALID',
      '功能运行事实不符合统一探针协议',
      feature,
      method,
      identity,
      error,
    );
  }
  if (fact.operationId !== identity.operationId || fact.runId !== identity.runId) {
    throw operationError(
      'FEATURE_OPERATION_IDENTITY_MISMATCH',
      '功能运行事实与请求句柄不一致',
      feature,
      method,
      identity,
    );
  }
  return structuredClone(fact);
}

function operationIdentity(
  value: unknown,
  feature: CollaborationFeature,
  method: string,
): OperationIdentity {
  if (!isRecord(value) || !isIdentifier(value.operationId) || !isIdentifier(value.runId)) {
    throw operationError(
      'FEATURE_OPERATION_RECEIPT_INVALID',
      '功能运行回执缺少统一身份',
      feature,
      method,
    );
  }
  return { operationId: value.operationId, runId: value.runId };
}

function operationError(
  code: string,
  message: string,
  feature: CollaborationFeature,
  method: string,
  identity?: OperationIdentity,
  cause?: unknown,
) {
  return frameworkError({
    code, kind: 'protocol', message, source: 'collaboration.router', retryable: false,
    details: { feature, method, ...identity },
  }, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
}
