import { resolveModelGenerationBudget } from '../llm-bridge.js';
import type { ProviderGenerationBudget } from '../../../model-runtime/providers/generation-budget.js';
import type { CompactionOptions, CompactionReason } from './contracts.js';

const SUMMARY_REASONING_RESERVE = 2_048;

export interface SummaryModelBudget extends ProviderGenerationBudget {
  /** Available combined context after the provider's safety margin, when known. */
  contextTokens?: number;
}

/** The summary body has its own allowance; provider completion limits may also include thinking. */
export function summaryOutputBudget(reason: CompactionReason = 'manual'): number {
  return reason === 'manual' ? 30_000 : 60_000;
}

export async function resolveSummaryModelBudget(dataDir: string, model: string,
  reason: CompactionReason = 'manual'): Promise<SummaryModelBudget> {
  const budget = await resolveModelGenerationBudget(dataDir, model, {
    maxContentTokens: summaryOutputBudget(reason), reasoningReserveTokens: SUMMARY_REASONING_RESERVE,
    deferContextAllocation: true,
  });
  return { ...budget, ...(budget.inputTokens === undefined ? {}
    : { contextTokens: budget.inputTokens + budget.maxOutputTokens }) };
}
export async function resolveSummaryBudget(options: CompactionOptions, model: string,
  reason: CompactionReason = 'manual'): Promise<SummaryModelBudget> {
  if (!options.resolveSummaryBudget) return resolveSummaryModelBudget(options.dataDir, model, reason);
  // An injected resolver supplies an input budget, not a provider's combined completion limit.
  const maxContentTokens = summaryOutputBudget(reason);
  return { inputTokens: await options.resolveSummaryBudget(model), maxContentTokens,
    maxOutputTokens: maxContentTokens + SUMMARY_REASONING_RESERVE };
}

/** Preserve the complete input; only generation headroom is narrowed to the known model window. */
export function summaryGenerationBudget(inputTokens: number, limits: SummaryModelBudget,
  finalContextBudget = limits.maxContentTokens) {
  if (limits.contextTokens === undefined && limits.inputTokens !== undefined && inputTokens > limits.inputTokens) {
    throw new Error('整段历史超过压缩模型的输入容量，请选择容量更大的压缩模型；原文未更改');
  }
  const body = Math.floor(Math.min(limits.maxContentTokens, finalContextBudget));
  if (!Number.isFinite(body) || body < 1) throw new Error('当前上下文没有可供交接记录使用的空间，原文未更改');
  const reasoning = Math.min(SUMMARY_REASONING_RESERVE, Math.max(0, limits.maxOutputTokens - limits.maxContentTokens));
  const capacity = limits.contextTokens === undefined ? Infinity : limits.contextTokens - inputTokens - 256;
  const output = Math.floor(Math.min(limits.maxOutputTokens, body + reasoning, capacity));
  const maxContentTokens = Math.min(body, Math.floor(output * body / (body + reasoning)));
  if (maxContentTokens < 1) throw new Error('整段历史超过压缩模型的上下文容量，请选择容量更大的压缩模型；原文未更改');
  const maxReasoningTokens = Math.min(reasoning, output - maxContentTokens);
  return { maxContentTokens, maxReasoningTokens, maxOutputTokens: maxContentTokens + maxReasoningTokens };
}
