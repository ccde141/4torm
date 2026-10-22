/** Summaries scan lines without allocating a string array for the entire tool result. */
export function toolOutputSummary(text: string, skipEmpty = false): { lines: number; preview: string } {
  let lines = 0;
  let preview: string | undefined;
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    if (!skipEmpty || end > start) {
      lines += 1;
      preview ??= text.slice(start, Math.min(end, start + 60));
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return { lines, preview: preview ?? '' };
}
