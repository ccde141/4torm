export type TextToolResponse =
  | { kind: 'final'; content: string }
  | { kind: 'tool-call'; name: string; arguments: Record<string, unknown> }
  | { kind: 'invalid'; error: string };

export interface TextToolResult {
  name: string;
  content: string;
  ok: boolean;
}

const TOOL_CALL_FENCE = /^```(tool_call|json)[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envelopeSource(content: string): { source: string; fence?: string } {
  const trimmed = content.trim();
  const fenced = TOOL_CALL_FENCE.exec(trimmed);
  if (fenced) return { source: fenced[2].trim(), fence: fenced[1].toLowerCase() };
  return { source: trimmed };
}

function looksLikeToolCall(source: string, fence?: string): boolean {
  return fence === 'tool_call' || (
    source.startsWith('{')
    && /["']type["']\s*:\s*["']tool_call["']/.test(source)
  );
}

export function parseTextToolResponse(content: string): TextToolResponse {
  const trimmed = content.trim();
  const { source, fence } = envelopeSource(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return looksLikeToolCall(source, fence)
      ? { kind: 'invalid', error: 'Tool-call envelope is not valid JSON.' }
      : { kind: 'final', content };
  }

  if (!isRecord(parsed) || parsed.type !== 'tool_call') {
    return { kind: 'final', content };
  }
  if (!fence && source !== trimmed) return { kind: 'final', content };
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

export function formatTextToolCall(name: string, argumentsValue: Record<string, unknown>): string {
  return JSON.stringify({ type: 'tool_call', name, arguments: argumentsValue });
}

export function parseTextToolResult(content: string): TextToolResult | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(content.trim()); } catch { return undefined; }
  if (!isRecord(parsed) || parsed.type !== 'tool_result') return undefined;
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) return undefined;
  if (typeof parsed.content !== 'string' || typeof parsed.ok !== 'boolean') return undefined;
  return { name: parsed.name.trim(), content: parsed.content, ok: parsed.ok };
}
