export interface ParsedContent {
  think: string;
  answer: string;
  note: string;
  actions: Array<{ tool: string; args: Record<string, string> }>;
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
