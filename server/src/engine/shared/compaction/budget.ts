import { resolveModelGenerationBudget } from '../llm-bridge.js';
import type { CompactionOptions } from './contracts.js';

const SUMMARY_BODY_TOKENS = 20_000;
const SUMMARY_REASONING_RESERVE = 2_048;
const MAX_STAGE_INPUT_TOKENS = 96_000;

/** The summary body has its own allowance; provider completion limits may also include thinking. */
export function summaryOutputBudget(): number { return SUMMARY_BODY_TOKENS; }

export async function resolveSummaryModelBudget(dataDir: string, model: string) {
  const budget = await resolveModelGenerationBudget(dataDir, model, {
    maxContentTokens: SUMMARY_BODY_TOKENS, reasoningReserveTokens: SUMMARY_REASONING_RESERVE,
  });
  return { ...budget, inputTokens: Math.min(budget.inputTokens ?? 16_000, MAX_STAGE_INPUT_TOKENS) };
}
export async function resolveSummaryBudget(options: CompactionOptions, model: string) {
  if (!options.resolveSummaryBudget) return resolveSummaryModelBudget(options.dataDir, model);
  // An injected resolver supplies an input budget, not a provider's combined completion limit.
  return { inputTokens: Math.min(await options.resolveSummaryBudget(model) ?? 16_000, MAX_STAGE_INPUT_TOKENS),
    maxContentTokens: SUMMARY_BODY_TOKENS,
    maxOutputTokens: SUMMARY_BODY_TOKENS + SUMMARY_REASONING_RESERVE };
}

/** Short fragments must not inherit the completion allowance of a million-token archive. */
export function summaryStageBudget(sourceTokens: number, final: boolean,
  limits: { maxContentTokens: number; maxOutputTokens: number }) {
  const maxContentTokens = Math.min(limits.maxContentTokens, final ? SUMMARY_BODY_TOKENS : 3_072,
    Math.max(final ? 512 : 64, Math.ceil(sourceTokens * (final ? 0.45 : 0.2))));
  const maxReasoningTokens = Math.min(SUMMARY_REASONING_RESERVE, Math.max(256, Math.ceil(sourceTokens * 0.05)));
  return { maxContentTokens, maxReasoningTokens,
    maxOutputTokens: Math.min(limits.maxOutputTokens, maxContentTokens + maxReasoningTokens) };
}
