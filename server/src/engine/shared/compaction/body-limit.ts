import { estimateTextTokens } from './estimate.js';

/** Share the estimator's weights and iterate code points, never cut a UTF-16 pair in half. */
export function clipSummaryBody(text: string, maxTokens: number): string {
  return takeUnits(text, Math.max(0, Math.floor(maxTokens * 4))).text;
}

function takeUnits(text: string, budget: number): { text: string; units: number } {
  let units = 0;
  let end = 0;
  for (const char of text) {
    const weight = char.codePointAt(0)! > 0xff ? 4 : 1;
    if (units + weight > budget) break;
    units += weight;
    end += char.length;
  }
  return { text: text.slice(0, end), units };
}

/** Streamed text and the persisted summary use the same bounded body buffer. */
export function collectSummaryBody(maxTokens: number, onChunk?: (text: string) => void) {
  let body = '';
  let remaining = Math.floor(maxTokens * 4);
  let pending = '';
  let published = 0;
  let atLimit = false;
  return {
    read: () => body,
    atLimit: () => atLimit,
    accept(chunk: string) {
      let text = pending + chunk;
      pending = '';
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { pending = text.slice(-1); text = text.slice(0, -1); }
      const accepted = takeUnits(text, remaining);
      remaining -= accepted.units;
      body += accepted.text;
      atLimit ||= remaining === 0 || accepted.text.length < text.length;
      // Hold leading whitespace so an empty first phase cannot pollute the fallback's display.
      if (body.trim() && body.length > published) {
        onChunk?.(body.slice(published));
        published = body.length;
      }
    },
  };
}

/** An always-thinking provider may exhaust both phases. Retain facts, never invent a summary. */
export function compactionSourceExcerpt(text: string, maxTokens: number): string {
  const sourceBudget = Math.max(1, Math.floor(estimateTextTokens(text) * 0.45));
  const label = maxTokens >= 12 ? '[原文节选]\n' : '原文:';
  const remaining = Math.max(0, maxTokens - estimateTextTokens(label));
  // The label has its own space; a short source must not become a label-only "summary".
  const excerpt = clipSummaryBody(text, Math.min(remaining, sourceBudget));
  return clipSummaryBody(label + excerpt, maxTokens);
}
