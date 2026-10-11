import { frameworkError } from '../framework-error.js';
import type { ContextMessage } from '../types.js';
import type { CompactionOptions, CompactionPolicy, CompactionReason, CompactionSummaryInput } from './contracts.js';
import { estimateCompactionTokens, estimateTextTokens, serializeCompactionMessages } from './estimate.js';
import { compactionPrompt, compactionSourceMessage, compactionSummaryPrompt } from './prompt.js';
import { loadCompactionPolicy } from './policy.js';
import { summarizeInStages } from './staged-summary.js';
import { resolveSummaryBudget } from './budget.js';
import { clipSummaryBody } from './body-limit.js';
import { generateCompactionSummary } from './generation.js';
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
      const result = await summarizeWithModel(options, model, text, signal);
      validateCompactionSummary(result.summary, text, prefix, result.outputLimited);
      return result.summary;
    } catch (error) {
      if (signal?.aborted || isAborted(error)) throw error;
      await options.onNotice?.({ type: 'compaction-notice', severity: 'error', model,
        fallbackModel: models[index + 1], reason,
        message: models[index + 1]
          ? `压缩模型 ${model} 无法完成请求，正在改用 ${models[index + 1]}。`
          : `压缩模型 ${model} 无法完成请求，原始记录已保留。` });
      if (index === models.length - 1) throw error;
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
): Promise<{ summary: string; outputLimited: boolean }> {
  const prompt = compactionPrompt(options);
  const { inputTokens, maxContentTokens, maxOutputTokens } = await resolveSummaryBudget(options, model);
  const inputBudget = Math.floor(inputTokens * 0.75)
    - estimateTextTokens(compactionSummaryPrompt(prompt, text, maxContentTokens))
    - estimateTextTokens(compactionSourceMessage('')) - 256;
  if (inputBudget < 128) throw new Error('压缩模型的输入容量不足以承载压缩指令');
  const run = options.summarize ?? ((input: CompactionSummaryInput) => defaultSummarizer(options, input));
  let outputLimited = false;
  const summary = await summarizeInStages(text, inputBudget, async (fragment, final) => {
    outputLimited = false;
    const summary = await run({ model, prompt: compactionSummaryPrompt(prompt, fragment, maxContentTokens),
      text: fragment, maxContentTokens, maxOutputTokens, signal,
      onChunk: final ? options.onSummaryChunk : undefined,
      onOutputLimited: () => { outputLimited = true; } });
    const body = clipSummaryBody(summary, maxContentTokens);
    outputLimited ||= body !== summary;
    return body;
  }, signal, { maxContentTokens, isOutputLimited: () => outputLimited,
    onLimitedBody: options.onSummaryChunk });
  return { summary, outputLimited };
}

async function defaultSummarizer(options: CompactionOptions, input: CompactionSummaryInput): Promise<string> {
  return generateCompactionSummary({ ...input, dataDir: options.dataDir });
}

export function validateCompactionSummary(summary: string, original: string,
  prefix?: readonly ContextMessage[], outputLimited = false): void {
  if (!summary.trim()) throw frameworkError({ code: 'COMPACTION_EMPTY_SUMMARY', kind: 'provider',
    message: '压缩模型返回了空记录，原文未更改', source: 'compaction', retryable: false });
  const framedTokens = estimateCompactionTokens([{ role: 'system', content: `[历史压缩记录]\n${summary}` }]);
  // A capped partial body is already visible and deliberately accepted by the caller.
  // For tiny sources, framing may cost more than the original; do not discard that body.
  if (!outputLimited && (estimateTextTokens(summary) >= estimateTextTokens(original)
    || (prefix && framedTokens >= estimateCompactionTokens(prefix)))) {
    throw frameworkError({ code: 'COMPACTION_DID_NOT_REDUCE', kind: 'provider',
      message: '压缩结果未减少信息体量，原文未更改', source: 'compaction', retryable: false });
  }
}

function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
