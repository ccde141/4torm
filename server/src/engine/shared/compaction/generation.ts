import { callLLM } from '../llm-bridge.js';
import type { CompactionSummaryInput } from './contracts.js';
import { buildCompactionMessages } from './request.js';
import { collectSummaryBody } from './body-limit.js';
import { SummaryOutputLimitError } from './summary-limit.js';

export interface CompactionGenerationInput extends CompactionSummaryInput {
  dataDir: string;
}

export interface CompactionGenerationResult {
  content: string;
  source: 'model';
  outputLimited: boolean;
}

/** Only complete model output can replace historical context. */
export async function generateCompactionSummary(input: CompactionGenerationInput): Promise<string> {
  return (await generateCompactionResult(input)).content;
}

/** An empty budget-limited response must not replace the conversation with a source prefix. */
export async function generateCompactionResult(input: CompactionGenerationInput): Promise<CompactionGenerationResult> {
  const first = await generatePhase(input, false);
  input.signal?.throwIfAborted();
  if (first.body.trim()) return finish(input, first);
  if (first.finishReason !== 'length') throw new Error('压缩模型返回了空正文，原始记录已保留');
  // One explicit finishing phase, not a retry loop. Providers without a thinking switch
  // retain their supported mode and are still bounded by the completion allowance.
  const final = await generatePhase(input, true);
  input.signal?.throwIfAborted();
  if (final.body.trim()) return finish(input, final);
  if (final.finishReason !== 'length') throw new Error('压缩模型返回了空正文，原始记录已保留');
  input.onOutputLimited?.();
  throw new SummaryOutputLimitError('压缩模型耗尽生成预算仍未给出正文，原会话保留');
}

function finish(input: CompactionGenerationInput, phase: Awaited<ReturnType<typeof generatePhase>>): CompactionGenerationResult {
  if (phase.finishReason === 'length' || phase.clipped) {
    input.onOutputLimited?.();
    throw new SummaryOutputLimitError();
  }
  // A rejected partial phase must not be concatenated with a later accepted summary.
  input.onChunk?.(phase.body);
  return { content: phase.body, source: 'model', outputLimited: false };
}

async function generatePhase(input: CompactionGenerationInput, preferBody: boolean) {
  input.signal?.throwIfAborted();
  const body = collectSummaryBody(input.maxContentTokens);
  let reasoningUnits = 0;
  const reasoningLimit = preferBody ? 256
    : input.maxReasoningTokens ?? Math.min(2_048, Math.max(0, input.maxOutputTokens - input.maxContentTokens));
  const result = await callLLM({ dataDir: input.dataDir, fullModelKey: input.model, purpose: 'compaction',
    signal: input.signal, outputTokenBudget: input.maxOutputTokens,
    outputControl: { preferBody: true, allowEmptyAtLimit: true,
      shouldStop: () => body.atLimit() || (reasoningUnits > 0 && reasoningUnits >= reasoningLimit * 4) },
    messages: buildCompactionMessages(input, preferBody),
    tools: input.tools, historyToolTransport: input.historyToolTransport,
    options: { temperature: 0.1, maxTokens: input.maxOutputTokens },
    onChunk: text => body.accept(text),
    onReasoning: text => {
      for (const char of text) reasoningUnits += char.codePointAt(0)! > 0xff ? 4 : 1;
    },
  });
  return { body: body.read(), finishReason: result.finishReason, clipped: body.atLimit() };
}
