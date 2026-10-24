import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { recordModelRequest, parseModelUsageProgress, type ModelUsageProgress } from '../../../engine/shared/model-request-usage.js';

export interface TideUsageProgress {
  modelUsage?: ModelUsageProgress;
  calls: number;
  reportedCalls: number;
  latest?: TokenUsage;
  total?: TokenUsage;
}

export function advanceTideUsage(
  previous: TideUsageProgress | undefined, usage: TokenUsage | null,
): TideUsageProgress {
  const calls = (previous?.calls ?? 0) + 1;
  if (usage === null) {
    return { calls, reportedCalls: previous?.reportedCalls ?? 0,
      ...(previous?.modelUsage ? { modelUsage: previous.modelUsage } : {}),
      ...(previous?.total ? { total: previous.total } : {}) };
  }
  const actual = parseTokenUsage(usage);
  const prior = previous?.total;
  return { calls, reportedCalls: (previous?.reportedCalls ?? 0) + 1,
    ...(previous?.modelUsage ? { modelUsage: previous.modelUsage } : {}),
    latest: actual,
    total: prior ? { promptTokens: prior.promptTokens + actual.promptTokens,
      completionTokens: prior.completionTokens + actual.completionTokens,
      totalTokens: prior.totalTokens + actual.totalTokens } : actual };
}

export function mergeTideUsage(
  previous: TideUsageProgress | undefined, current: TideUsageProgress | undefined,
): TideUsageProgress | undefined {
  if (!current) return previous;
  if (!previous) return current;
  const total = current.total && previous.total
    ? { promptTokens: previous.total.promptTokens + current.total.promptTokens,
      completionTokens: previous.total.completionTokens + current.total.completionTokens,
      totalTokens: previous.total.totalTokens + current.total.totalTokens }
    : current.total ?? previous.total;
  let modelUsage = previous.modelUsage;
  for (const request of Object.values(current.modelUsage?.requests ?? {})) modelUsage = recordModelRequest(modelUsage, request);
  return { calls: previous.calls + current.calls,
    ...(modelUsage ? { modelUsage } : {}),
    reportedCalls: previous.reportedCalls + current.reportedCalls,
    ...(current.latest ? { latest: current.latest } : {}),
    ...(total ? { total } : {}) };
}

export function parseTideUsageProgress(value: unknown): TideUsageProgress {
  if (!record(value)) throw new Error('token usage progress must be an object');
  const calls = count(value.calls, 'calls');
  const reportedCalls = count(value.reportedCalls, 'reportedCalls');
  if (reportedCalls > calls) throw new Error('reportedCalls exceeds calls');
  const latest = value.latest === undefined ? undefined : parseTokenUsage(value.latest);
  const total = value.total === undefined ? undefined : parseTokenUsage(value.total);
  if (latest && !total) throw new Error('latest token usage lacks total');
  if (reportedCalls === 0 && (latest || total)) throw new Error('unreported token usage has values');
  return { calls, reportedCalls, ...(latest ? { latest } : {}), ...(total ? { total } : {}),
    ...(value.modelUsage ? { modelUsage: parseModelUsageProgress(value.modelUsage) } : {}) };
}

export function parseTokenUsage(value: unknown): TokenUsage {
  if (!record(value)) throw new Error('token usage must be an object');
  return { promptTokens: count(value.promptTokens, 'promptTokens'),
    completionTokens: count(value.completionTokens, 'completionTokens'),
    totalTokens: count(value.totalTokens, 'totalTokens') };
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
