import { compactionPrompt, compactionSummaryPrompt, generateCompactionSummary,
  resolveSummaryModelBudget, summaryOutputBudget }
  from '../../../engine/shared/compaction/index.js';
import type { MonsoonCompactionSummarizer } from '../application/compaction-service.js';

export const summarizeMonsoonCompaction: MonsoonCompactionSummarizer = async input => {
  const budget = input.maxOutputTokens === undefined
    ? await resolveSummaryModelBudget(input.dataDir, input.model)
    : { maxOutputTokens: input.maxOutputTokens, maxContentTokens: input.maxContentTokens ?? summaryOutputBudget() };
  return generateCompactionSummary({
    dataDir: input.dataDir, model: input.model, signal: input.signal,
    text: input.dialogText, ...budget,
    maxReasoningTokens: input.maxReasoningTokens,
    prompt: input.prompt ?? compactionSummaryPrompt(
      compactionPrompt({ kind: 'conversation', area: 'monsoon' }), input.dialogText, budget.maxContentTokens),
    onChunk: input.onChunk,
    onOutputLimited: input.onOutputLimited,
  });
};
