import { frameworkError } from '../framework-error.js';
import type { ContextMessage } from '../types.js';
import type { CompactionOptions, CompactionPolicy, CompactionReason, CompactionSummaryInput } from './contracts.js';
import { estimateCompactionTokens, estimateTextTokens, serializeCompactionMessages } from './estimate.js';
import { compactionPrompt, compactionSummaryPrompt } from './prompt.js';
import { loadCompactionPolicy } from './policy.js';
import { resolveSummaryBudget, summaryGenerationBudget } from './budget.js';
import { generateCompactionSummary } from './generation.js';
import { SummaryOutputLimitError } from './summary-limit.js';
import { CompactionNoGainError } from './errors.js';
import { buildCompactionMessages } from './request.js';
export { summaryOutputBudget } from './budget.js';

export async function summarizeCompactionPrefix(
  options: CompactionOptions, prefix: readonly ContextMessage[], signal?: AbortSignal,
  reason: CompactionReason = 'manual', suppliedPolicy?: CompactionPolicy,
): Promise<string> {
  const policy = suppliedPolicy ?? await loadCompactionPolicy(options.dataDir);
  const models = summaryModels(options, policy);
  const text = serializeCompactionMessages(prefix);
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    try {
      const summary = await summarizeWithModel(options, model, text, signal, prefix, reason);
      return summary;
    } catch (error) {
      if (signal?.aborted || isAborted(error)) throw error;
      const unknownOutcome = (!!error && typeof error === 'object' && 'data' in error
          && !!error.data && typeof error.data === 'object' && 'code' in error.data
          && ['MODEL_PROVIDER_UNREACHABLE', 'MODEL_RESPONSE_TIMEOUT'].includes(String(error.data.code)));
      const fallbackModel = unknownOutcome ? undefined : models[index + 1];
      await options.onNotice?.({ type: 'compaction-notice', severity: 'error', model,
        fallbackModel, reason,
        message: fallbackModel
          ? `压缩模型 ${model} 无法完成请求，正在改用 ${fallbackModel}。`
          : `压缩模型 ${model} 无法完成请求，原始记录已保留。` });
      if (!fallbackModel) throw error;
    }
  }
  throw new Error('没有可用的压缩模型');
}

function summaryModels(options: CompactionOptions, policy: CompactionPolicy): string[] {
  const primary = options.kind === 'meeting' ? options.chairModel
    : policy.modelMode === 'fixed' ? policy.fixedModel : options.model;
  if (!primary) throw frameworkError({ code: 'COMPACTION_MODEL_MISSING', kind: 'validation',
    message: options.kind === 'meeting' ? '会议未配置会长压缩模型' : '未配置压缩模型',
    source: 'compaction', retryable: false });
  const alternate = options.kind === 'meeting' ? policy.fixedModel
    : primary === policy.fixedModel ? options.model : policy.fixedModel;
  return [...new Set([primary, alternate].filter((model): model is string => !!model))];
}

async function summarizeWithModel(
  options: CompactionOptions, model: string, text: string, signal?: AbortSignal,
  prefix?: readonly ContextMessage[], reason: CompactionReason = 'manual',
): Promise<string> {
  signal?.throwIfAborted();
  const prompt = compactionPrompt(options);
  const messages = structuredClone([...(options.summaryContext?.messages ?? []), ...(prefix ?? [])]);
  const limits = await resolveSummaryBudget(options, model, reason);
  const instruction = compactionSummaryPrompt(prompt, text,
    Math.min(limits.maxContentTokens, options.summaryTokenBudget ?? limits.maxContentTokens));
  const inputTokens = estimateCompactionTokens(buildCompactionMessages({ messages, prompt: instruction }))
    + estimateTextTokens(JSON.stringify(options.summaryContext?.tools ?? []));
  const budget = summaryGenerationBudget(inputTokens, limits, options.summaryTokenBudget);
  const run = options.summarize ?? ((input: CompactionSummaryInput) => defaultSummarizer(options, input));
  let outputLimited = false;
  const summary = await run({ model, prompt: compactionSummaryPrompt(prompt, text, budget.maxContentTokens),
    messages, tools: options.summaryContext?.tools,
    historyToolTransport: options.summaryContext?.historyToolTransport,
    text, ...budget, signal, onOutputLimited: () => { outputLimited = true; } });
  signal?.throwIfAborted();
  if (outputLimited || estimateTextTokens(summary) > budget.maxContentTokens) throw new SummaryOutputLimitError();
  validateCompactionSummary(summary, text, prefix);
  options.onSummaryChunk?.(summary);
  return summary;
}

async function defaultSummarizer(options: CompactionOptions, input: CompactionSummaryInput): Promise<string> {
  return generateCompactionSummary({ ...input, dataDir: options.dataDir });
}

export function validateCompactionSummary(summary: string, original: string,
  prefix?: readonly ContextMessage[]): void {
  if (!summary.trim()) throw frameworkError({ code: 'COMPACTION_EMPTY_SUMMARY', kind: 'provider',
    message: '压缩模型返回了空记录，原文未更改', source: 'compaction', retryable: false });
  const framedTokens = estimateCompactionTokens([{ role: 'system', content: `[历史压缩记录]\n${summary}` }]);
  if (estimateTextTokens(summary) >= estimateTextTokens(original)
    || (prefix && framedTokens >= estimateCompactionTokens(prefix))) {
    throw new CompactionNoGainError();
  }
}

function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
