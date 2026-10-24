import { callLLM } from '../llm-bridge.js';
import type { CompactionSummaryInput } from './contracts.js';
import { compactionSourceMessage } from './prompt.js';
import { collectSummaryBody } from './body-limit.js';
import { compactionRequestDeadline } from './request-deadline.js';

export interface CompactionGenerationInput extends CompactionSummaryInput {
  dataDir: string;
}

export interface CompactionGenerationResult {
  content: string;
  source: 'model';
  outputLimited: boolean;
}

/** Budget exhaustion is normal completion, unlike a failed request or human cancellation. */
export async function generateCompactionSummary(input: CompactionGenerationInput): Promise<string> {
  return (await generateCompactionResult(input)).content;
}

/** An empty budget-limited response must not replace the conversation with a source prefix. */
export async function generateCompactionResult(input: CompactionGenerationInput): Promise<CompactionGenerationResult> {
  const first = await generatePhase(input, false);
  input.signal?.throwIfAborted();
  if (first.body.trim()) return finish(input, first.body, 'model', first.finishReason === 'length');
  if (first.finishReason !== 'length') throw new Error('压缩模型返回了空正文，原始记录已保留');
  // One explicit finishing phase, not a retry loop. Providers without a thinking switch
  // retain their supported mode and are still bounded by the completion allowance.
  const final = await generatePhase(input, true);
  input.signal?.throwIfAborted();
  if (final.body.trim()) return finish(input, final.body, 'model', final.finishReason === 'length');
  if (final.finishReason !== 'length') throw new Error('压缩模型返回了空正文，原始记录已保留');
  throw new Error('压缩模型耗尽生成预算仍未给出正文，原会话与已完成片段保留');
}

function finish(input: CompactionGenerationInput, content: string,
  source: CompactionGenerationResult['source'], outputLimited: boolean): CompactionGenerationResult {
  if (outputLimited) input.onOutputLimited?.();
  return { content, source, outputLimited };
}

async function generatePhase(input: CompactionGenerationInput, preferBody: boolean) {
  input.signal?.throwIfAborted();
  const body = collectSummaryBody(input.maxContentTokens, input.onChunk);
  let reasoningUnits = 0;
  const reasoningLimit = preferBody ? 256
    : input.maxReasoningTokens ?? Math.min(2_048, Math.max(0, input.maxOutputTokens - input.maxContentTokens));
  const prompt = preferBody ? input.prompt + '\n思考预算已经用尽。现在直接输出简短压缩正文，'
    + '先保留任务目标、已核实事实、必要 ID 与未完成事项；不要继续推导，不要输出思考过程。' : input.prompt;
  const deadline = compactionRequestDeadline(input.signal);
  try {
    const result = await callLLM({ dataDir: input.dataDir, fullModelKey: input.model, purpose: 'compaction',
      signal: deadline.signal, outputTokenBudget: input.maxOutputTokens,
      outputControl: { preferBody: true, allowEmptyAtLimit: true,
        shouldStop: () => body.atLimit() || (reasoningUnits > 0 && reasoningUnits >= reasoningLimit * 4) },
      messages: [{ role: 'system', content: prompt },
        { role: 'user', content: compactionSourceMessage(input.text) }],
      options: { temperature: 0.1, maxTokens: input.maxOutputTokens },
      onChunk: text => { deadline.touch(); body.accept(text); },
      onReasoning: text => {
        deadline.touch();
        for (const char of text) reasoningUnits += char.codePointAt(0)! > 0xff ? 4 : 1;
      },
    });
    return { body: body.read(), finishReason: result.finishReason };
  } catch (error) {
    if (deadline.signal.aborted && !input.signal?.aborted) throw deadline.signal.reason;
    throw error;
  } finally { deadline.dispose(); }
}
