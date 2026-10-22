export interface ParsedContent {
  think: string;
  answer: string;
  note: string;
  actions: Array<{ tool: string; args: Record<string, unknown> }>;
  raw: string;
}

export function parseStructuredContent(content: string): ParsedContent {
  return {
    think: '',
    answer: content,
    note: '',
    actions: [],
    raw: content,
  };
}
