import { frameworkError } from '../framework-error.js';
import type { ContextMessage } from '../types.js';
import type { CompactionOptions, CompactionPolicy, CompactionReason, CompactionSummaryInput } from './contracts.js';
import { estimateCompactionTokens, estimateTextTokens, serializeCompactionMessages } from './estimate.js';
import { compactionPrompt, compactionSourceMessage, compactionSummaryPrompt } from './prompt.js';
import { loadCompactionPolicy } from './policy.js';
import { summarizeInStages } from './staged-summary.js';
import { resolveSummaryBudget, summaryStageBudget } from './budget.js';
import { openSummaryCheckpoint, summaryHash } from './checkpoint.js';
import { clipSummaryBody } from './body-limit.js';
import { generateCompactionSummary } from './generation.js';
import { CompactionRequestTimeout } from './request-deadline.js';
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
      const summary = await summarizeWithModel(options, model, text, signal, prefix);
      validateCompactionSummary(summary, text, prefix);
      return summary;
    } catch (error) {
      if (signal?.aborted || isAborted(error)) throw error;
      const unknownOutcome = error instanceof CompactionRequestTimeout
        || (!!error && typeof error === 'object' && 'data' in error
          && !!error.data && typeof error.data === 'object' && 'code' in error.data
          && error.data.code === 'MODEL_PROVIDER_UNREACHABLE');
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
  prefix?: readonly ContextMessage[],
): Promise<string> {
  const prompt = compactionPrompt(options);
  const { inputTokens, maxContentTokens, maxOutputTokens } = await resolveSummaryBudget(options, model);
  const inputBudget = Math.floor(inputTokens * 0.75)
    - estimateTextTokens(compactionSummaryPrompt(prompt, text, maxContentTokens))
    - estimateTextTokens(compactionSourceMessage('')) - 256;
  if (inputBudget < 128) throw new Error('压缩模型的输入容量不足以承载压缩指令');
  const run = options.summarize ?? ((input: CompactionSummaryInput) => defaultSummarizer(options, input));
  const checkpoint = await openSummaryCheckpoint(options.dataDir, options.scopeKey, model,
    summaryHash(JSON.stringify({ version: 3, text, prompt, inputBudget, maxContentTokens, maxOutputTokens })));
  const summary = await summarizeInStages(text, inputBudget, async (fragment, final) => {
    const stageBudget = summaryStageBudget(estimateTextTokens(fragment), final, { maxContentTokens, maxOutputTokens });
    const summary = await run({ model, prompt: compactionSummaryPrompt(prompt, fragment, stageBudget.maxContentTokens),
      text: fragment, ...stageBudget, signal,
      onChunk: final ? options.onSummaryChunk : undefined });
    return clipSummaryBody(summary, stageBudget.maxContentTokens);
  }, signal, { checkpoint, onProgress: options.onStageProgress, onCachedFinal: options.onSummaryChunk,
    quotedSource: true, validateFinal: body => validateCompactionSummary(body, text, prefix) });
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
    throw frameworkError({ code: 'COMPACTION_DID_NOT_REDUCE', kind: 'provider',
      message: '压缩结果未减少信息体量，原文未更改', source: 'compaction', retryable: false });
  }
}

function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
