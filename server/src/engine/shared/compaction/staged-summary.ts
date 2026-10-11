import { estimateTextTokens } from './estimate.js';
import { clipSummaryBody } from './body-limit.js';

interface SummaryStageControl {
  maxContentTokens: number;
  isOutputLimited: () => boolean;
  onLimitedBody?: (text: string) => void;
}

/** Normal stages cover every fragment. An explicit output cap accepts a labelled partial result. */
export async function summarizeInStages(
  original: string, inputBudget: number, summarize: (text: string, final: boolean) => Promise<string>,
  signal?: AbortSignal, control?: SummaryStageControl,
): Promise<string> {
  let text = original;
  for (let level = 0; level < 8; level++) {
    signal?.throwIfAborted();
    const chunks = splitSummaryText(text, inputBudget);
    if (chunks.length > 256) throw new Error('压缩记录超过分段处理容量');
    const summaries: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      signal?.throwIfAborted();
      const fragment = chunks.length > 1
        ? `历史连续片段 ${index + 1}/${chunks.length}；只总结该片段，保留关联身份和必要 ID。\n${chunks[index]}`
        : chunks[index];
      const summary = await summarize(fragment, chunks.length === 1);
      if (!summary.trim()) throw new Error('压缩模型返回了空片段');
      summaries.push(summary);
      if (control?.isOutputLimited()) {
        if (chunks.length === 1) return summary;
        const partial = clipSummaryBody('[输出达到限额；部分摘要，其余资料保存在原始归档]\n'
          + summaries.join('\n\n'), control.maxContentTokens);
        control.onLimitedBody?.(partial);
        return partial;
      }
    }
    const combined = summaries.join('\n\n');
    if (chunks.length === 1) return combined;
    if (estimateTextTokens(combined) >= estimateTextTokens(text)) {
      throw new Error('分段压缩未降低信息体量');
    }
    text = combined;
  }
  throw new Error('压缩记录无法收敛到模型容量内');
}

export function splitSummaryText(text: string, budget: number): string[] {
  const chunks: string[] = [];
  let pending = '';
  // Prefer paragraph/record boundaries. Very large single tool results are split without losing bytes.
  for (const paragraph of text.split(/(?<=\n\n)/)) {
    if (estimateTextTokens(pending + paragraph) <= budget) { pending += paragraph; continue; }
    if (pending) { chunks.push(pending); pending = ''; }
    for (const part of splitLongParagraph(paragraph, budget)) {
      if (estimateTextTokens(pending + part) > budget && pending) {
        chunks.push(pending); pending = '';
      }
      pending += part;
    }
  }
  if (pending) chunks.push(pending);
  return chunks;
}

function splitLongParagraph(text: string, budget: number): string[] {
  if (estimateTextTokens(text) <= budget) return [text];
  const parts: string[] = [];
  let pending = '';
  let tokens = 0;
  for (const char of text) {
    const weight = char.codePointAt(0)! > 0xff ? 1 : 0.25;
    if (tokens + weight > budget) { parts.push(pending); pending = ''; tokens = 0; }
    pending += char;
    tokens += weight;
  }
  if (pending) parts.push(pending);
  return parts;
}
