/** Share the estimator's weights and iterate code points, never cut a UTF-16 pair in half. */
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
export function collectSummaryBody(maxTokens: number) {
  let body = '';
  let remaining = Math.floor(maxTokens * 4);
  let pending = '';
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
      // Exactly filling the allowance can still be a complete provider response.
      // Only an omitted code point proves that the buffer clipped its body.
      atLimit ||= accepted.text.length < text.length;
    },
  };
}
