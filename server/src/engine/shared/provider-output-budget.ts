import {
  resolveMaxOutputTokens, resolveProviderModelCapabilities, type ProviderModelIdentity,
} from './provider-normalization.js';

/** Explicit framework budgets survive custom defaults; ordinary calls retain their existing precedence. */
export function enforceProviderOutputBudget(
  body: Record<string, unknown>, maxTokens: number | undefined,
  identity?: ProviderModelIdentity,
): void {
  if (maxTokens === undefined) return;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('模型输出预算必须为正整数');
  const field = identity ? resolveProviderModelCapabilities(identity).maxTokensField : 'max_tokens';
  delete body.max_tokens;
  delete body.max_completion_tokens;
  if (field !== 'omit') body[field] = identity ? resolveMaxOutputTokens(identity, maxTokens) : maxTokens;
}
