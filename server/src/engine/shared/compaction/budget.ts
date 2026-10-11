import { resolveModelGenerationBudget } from '../llm-bridge.js';
import type { CompactionOptions } from './contracts.js';

const SUMMARY_BODY_TOKENS = 20_000;
const SUMMARY_REASONING_RESERVE = 32_000;

/** The summary body has its own allowance; provider completion limits may also include thinking. */
export function summaryOutputBudget(): number { return SUMMARY_BODY_TOKENS; }

export async function resolveSummaryModelBudget(dataDir: string, model: string) {
  const budget = await resolveModelGenerationBudget(dataDir, model, {
    maxContentTokens: SUMMARY_BODY_TOKENS, reasoningReserveTokens: SUMMARY_REASONING_RESERVE,
  });
  return { ...budget, inputTokens: budget.inputTokens ?? 16_000 };
}
export async function resolveSummaryBudget(options: CompactionOptions, model: string) {
  if (!options.resolveSummaryBudget) return resolveSummaryModelBudget(options.dataDir, model);
  // An injected resolver supplies an input budget, not a provider's combined completion limit.
  return { inputTokens: await options.resolveSummaryBudget(model) ?? 16_000,
    maxContentTokens: SUMMARY_BODY_TOKENS,
    maxOutputTokens: SUMMARY_BODY_TOKENS + SUMMARY_REASONING_RESERVE };
}
