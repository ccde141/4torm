import type { ToolDef } from '../store/tools';

export interface ParsedRound {
  think: string;
  plan: string;
  planItems: Array<{ done: boolean; text: string }>;
  actions: Array<{ tool: string; args: Record<string, string> }>;
  answer: string;
  note: string;
}

export function parseStructuredOutput(content: string, toolDefs: ToolDef[]): ParsedRound {
  const round: ParsedRound = { think: '', plan: '', planItems: [], actions: [], answer: '', note: '' };

  const extract = (tag: string) => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    return (content.match(re)?.[1] || '').trim();
  };

  round.think = extract('think');
  round.answer = extract('answer');
  round.note = extract('note');

  const planRaw = extract('plan');
  if (planRaw) {
    round.plan = planRaw;
    const items = planRaw.split('\n').filter(l => l.trim());
    for (const item of items) {
      const done = /^\[[✓✅\*xX]\]/.test(item);
      const text = item.replace(/^\[.\]/, '').trim();
      if (text) round.planItems.push({ done, text });
    }
  }

  const actionRegex = /<action\s+tool\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/action>/gi;
  let m;
  while ((m = actionRegex.exec(content)) !== null) {
    const tool = m[1].trim();
    const jsonStr = m[2].trim();
    if (toolDefs.some(t => t.name.toLowerCase() === tool.toLowerCase())) {
      let args: Record<string, string> = {};
      try { args = JSON.parse(jsonStr); } catch { args = { _raw: jsonStr }; }
      round.actions.push({ tool, args });
    }
  }

  return round;
}

export function extractResult(content: string): string {
  const m = content.match(/<result>([\s\S]*?)<\/result>/i);
  return m?.[1]?.trim() || '';
}
