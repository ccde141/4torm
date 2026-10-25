import { estimateTextTokens } from './estimate.js';
import { summaryHash, type SummaryCheckpoint } from './checkpoint.js';
import type { CompactionStageProgress } from './contracts.js';

interface SummaryStageControl {
  checkpoint?: SummaryCheckpoint;
  onProgress?: (stage: CompactionStageProgress) => void | Promise<void>;
  onCachedFinal?: (text: string) => void;
  quotedSource?: boolean;
  validateFinal?: (summary: string) => void;
}

/** Every fragment is visited, even when an individual response reaches its output cap. */
export async function summarizeInStages(
  original: string, inputBudget: number, summarize: (text: string, final: boolean) => Promise<string>,
  signal?: AbortSignal, control?: SummaryStageControl,
): Promise<string> {
  let text = original;
  for (let level = 0; ; level++) {
    signal?.throwIfAborted();
    const chunks = splitSummaryText(text, inputBudget, control?.quotedSource);
    const summaries: string[] = [];
    const keys: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      signal?.throwIfAborted();
      const fragment = chunks.length > 1
        ? `历史连续片段 ${index + 1}/${chunks.length}；只总结该片段，保留关联身份和必要 ID。\n${chunks[index]}`
        : chunks[index];
      const key = summaryHash(`${level}:${index}:${chunks.length}:${fragment}`);
      keys.push(key);
      const cached = control?.checkpoint?.read(key);
      await control?.onProgress?.({ level, index, total: chunks.length, completed: index, resumed: !!cached });
      signal?.throwIfAborted();
      const summary = cached ?? await summarize(fragment, chunks.length === 1);
      if (!summary.trim()) throw new Error('压缩模型返回了空片段');
      if (chunks.length === 1) control?.validateFinal?.(summary);
      else if (estimateTextTokens(chunks[index]) > 128
        && estimateTextTokens(summary) >= estimateTextTokens(chunks[index])) throw new Error('分段压缩未降低信息体量');
      signal?.throwIfAborted();
      if (!cached) await control?.checkpoint?.save(key, summary);
      else if (chunks.length === 1) control?.onCachedFinal?.(summary);
      summaries.push(summary);
      await control?.onProgress?.({ level, index, total: chunks.length, completed: index + 1, resumed: !!cached });
    }
    const combined = summaries.join('\n\n');
    if (chunks.length === 1) return combined;
    if (estimateTextTokens(combined) >= estimateTextTokens(text)) {
      await control?.checkpoint?.remove(keys);
      throw new Error('分段压缩未降低信息体量');
    }
    text = combined;
  }
}

export function splitSummaryText(text: string, budget: number, quoted = false): string[] {
  const chunks: string[] = [];
  let pending = '';
  const estimate = (value: string) => estimateTextTokens(quoted ? JSON.stringify(value) : value);
  // Prefer paragraph/record boundaries. Very large single tool results are split without losing bytes.
  for (const paragraph of text.split(/(?<=\n\n)/)) {
    if (estimate(pending + paragraph) <= budget) { pending += paragraph; continue; }
    if (pending) { chunks.push(pending); pending = ''; }
    for (const part of splitLongParagraph(paragraph, budget, quoted)) {
      if (estimate(pending + part) > budget && pending) {
        chunks.push(pending); pending = '';
      }
      pending += part;
    }
  }
  if (pending) chunks.push(pending);
  return chunks;
}

function splitLongParagraph(text: string, budget: number, quoted: boolean): string[] {
  if (estimateTextTokens(quoted ? JSON.stringify(text) : text) <= budget) return [text];
  const parts: string[] = [];
  let pending = '';
  let tokens = quoted ? 0.5 : 0;
  for (const char of text) {
    const weight = char.codePointAt(0)! > 0xff ? 1
      : quoted ? (JSON.stringify(char).length - 2) / 4 : 0.25;
    if (tokens + weight > budget) { parts.push(pending); pending = ''; tokens = quoted ? 0.5 : 0; }
    pending += char;
    tokens += weight;
  }
  if (pending) parts.push(pending);
  return parts;
}
