import type {
  ProviderGenerationLimits,
  ProviderModelIdentity,
  ProviderRuntimeFetch,
} from '../contracts/provider-adapter.js';
import { resolveProviderAdapter } from './registry.js';

export interface ProviderGenerationBudgetRequest {
  maxContentTokens: number;
  reasoningReserveTokens: number;
  /** Measure the complete input before allocating context between input and output. */
  deferContextAllocation?: boolean;
}

export interface ProviderGenerationBudget {
  inputTokens?: number;
  maxContentTokens: number;
  maxOutputTokens: number;
}

/** Thinking is extra request capacity; merged-output APIs do not enforce separate quotas. */
export async function resolveProviderGenerationBudget(
  identity: ProviderModelIdentity,
  requested: ProviderGenerationBudgetRequest,
  fetchImpl: ProviderRuntimeFetch = fetch,
): Promise<ProviderGenerationBudget> {
  validateRequest(requested);
  const adapter = resolveProviderAdapter(identity);
  const limits = adapter.generationLimits?.(identity) ?? {};
  const runtime = await adapter.discoverRuntimeCapabilities?.(identity, fetchImpl);
  const context = minimumKnown(limits.contextWindowTokens, runtime?.contextWindowTokens);
  return allocateBudget(requested, limits, context);
}

function allocateBudget(
  requested: ProviderGenerationBudgetRequest,
  limits: ProviderGenerationLimits,
  context?: number,
): ProviderGenerationBudget {
  const reserve = limits.reasoning === false ? 0 : requested.reasoningReserveTokens;
  const total = requested.maxContentTokens + reserve;
  const usable = context === undefined ? undefined : context - Math.ceil(context * 0.05);
  const windowLimit = usable === undefined ? undefined
    : requested.deferContextAllocation ? usable : Math.floor(usable * 0.25);
  const maxOutputTokens = Math.min(total, minimumKnown(limits.maxOutputTokens, windowLimit) ?? total);
  const maxContentTokens = Math.floor(maxOutputTokens * requested.maxContentTokens / total);
  if (maxContentTokens < 1) throw new Error('模型容量不足以容纳压缩正文预算');
  return {
    maxContentTokens,
    maxOutputTokens,
    ...(usable === undefined ? {} : { inputTokens: usable - maxOutputTokens }),
  };
}

function minimumKnown(first?: number, second?: number): number | undefined {
  const values = [first, second].filter((value): value is number => value !== undefined);
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('模型容量必须是正整数');
  }
  return values.length ? Math.min(...values) : undefined;
}

function validateRequest(requested: ProviderGenerationBudgetRequest): void {
  if (requested.deferContextAllocation !== undefined && typeof requested.deferContextAllocation !== 'boolean') {
    throw new Error('上下文预算延迟分配选项必须是布尔值');
  }
  if (!Number.isSafeInteger(requested.maxContentTokens) || requested.maxContentTokens < 1) {
    throw new Error('压缩正文预算必须是正整数');
  }
  if (!Number.isSafeInteger(requested.reasoningReserveTokens) || requested.reasoningReserveTokens < 0) {
    throw new Error('思考预留预算必须是非负整数');
  }
  if (!Number.isSafeInteger(requested.maxContentTokens + requested.reasoningReserveTokens)) {
    throw new Error('压缩生成预算超过安全整数范围');
  }
}
