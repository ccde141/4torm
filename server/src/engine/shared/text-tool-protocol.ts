export type TextToolResponse =
  | { kind: 'final'; content: string }
  | { kind: 'tool-call'; name: string; arguments: Record<string, unknown> }
  | { kind: 'invalid'; error: string };

const TOOL_CALL_FENCE = /^```tool_call\s*\r?\n([\s\S]*?)\r?\n```$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envelopeSource(content: string): { source: string; explicit: boolean } {
  const trimmed = content.trim();
  const fenced = TOOL_CALL_FENCE.exec(trimmed);
  if (fenced) return { source: fenced[1].trim(), explicit: true };
  return { source: trimmed, explicit: false };
}

function looksLikeToolCall(source: string, explicit: boolean): boolean {
  return explicit || (
    source.startsWith('{')
    && /["']type["']\s*:\s*["']tool_call["']/.test(source)
  );
}

export function parseTextToolResponse(content: string): TextToolResponse {
  const trimmed = content.trim();
  const { source, explicit } = envelopeSource(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return looksLikeToolCall(source, explicit)
      ? { kind: 'invalid', error: 'Tool-call envelope is not valid JSON.' }
      : { kind: 'final', content };
  }

  if (!isRecord(parsed) || parsed.type !== 'tool_call') {
    return { kind: 'final', content };
  }
  if (!explicit && source !== trimmed) return { kind: 'final', content };
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return { kind: 'invalid', error: 'Tool-call name must be a non-empty string.' };
  }
  if (!isRecord(parsed.arguments)) {
    return { kind: 'invalid', error: 'Tool-call arguments must be a JSON object.' };
  }
  return { kind: 'tool-call', name: parsed.name.trim(), arguments: parsed.arguments };
}

export function formatTextToolResult(name: string, content: string, ok: boolean): string {
  return JSON.stringify({ type: 'tool_result', name, ok, content });
}
