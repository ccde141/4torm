const MAX_CHARS = 32_000;
const MAX_STRUCTURE = 1_024;
const MAX_MATH_COMMANDS = 80;
const MAX_DEPTH = 32;
const MAX_LINES = 480;
const EXPANDING_MACRO = /^(?:def|gdef|edef|xdef|newcommand|renewcommand|let|futurelet|loop|csname)\b/;
interface Fence { marker: string; length: number }

/** A bounded linear preflight runs before Markdown/KaTeX may allocate an expanded tree. */
export function mayRenderMarkdown(text: string): boolean {
  if (text.length > MAX_CHARS) return false;
  let structure = 0, commands = 0, depth = 0, quotes = 0, lines = 0;
  let fence: Fence | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (index === 0 || text[index - 1] === '\n') {
      if (++lines > MAX_LINES) return false;
      quotes = 0;
      const nextFence = fenceAt(text, index, fence);
      if (nextFence !== undefined) { fence = nextFence; continue; }
    }
    if (fence) continue;
    // Count inline code too: an unmatched backtick must not hide later math from the budget.
    if (char === '\\') {
      if (EXPANDING_MACRO.test(text.slice(index + 1, index + 17))) return false;
      if (/[a-zA-Z]/.test(text[index + 1] ?? '') || ['(', '['].includes(text[index + 1])) commands++;
      if (text[index + 1] === '\\') structure += 8;
      index++;
    } else if ('|$*_[]{}>!\n&^'.includes(char)) {
      structure += '$&^'.includes(char) ? 8 : 1;
      if (char === '[' || char === '{') depth++;
      if (char === ']' || char === '}') depth = Math.max(0, depth - 1);
      if (char === '>' && ++quotes > MAX_DEPTH) return false;
    }
    if (structure > MAX_STRUCTURE || commands > MAX_MATH_COMMANDS || depth > MAX_DEPTH) return false;
  }
  return true;
}

function fenceAt(text: string, index: number, current: Fence | null): Fence | null | undefined {
  // Each line is inspected once; invalid info strings must not conceal later math.
  const end = text.indexOf('\n', index);
  const line = text.slice(index, end < 0 ? text.length : end).replace(/^ {0,3}/, '');
  const run = /^(?:`{3,}|~{3,})/.exec(line)?.[0];
  if (!run) return undefined;
  const rest = line.slice(run.length);
  if (current) return run[0] === current.marker && run.length >= current.length && !rest.trim()
    ? null : undefined;
  if (run[0] === '`' && rest.includes('`')) return undefined;
  return { marker: run[0], length: run.length };
}
