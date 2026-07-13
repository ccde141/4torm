/**
 * 信风 Agent 节点结构化输出解析器
 *
 * 从 src/engine/parser.ts 复制解耦，独立演进。
 * 提取 <think>、<answer>、<action> 标签。
 *
 * 信风独立副本，可自主演进。
 */

export interface ParsedContent {
  think: string;
  answer: string;
  note: string;
  actions: Array<{ tool: string; args: Record<string, string> }>;
  raw: string;
}

export function parseStructuredContent(content: string): ParsedContent {
  const result: ParsedContent = { think: '', answer: '', note: '', actions: [], raw: content };

  // 提取 <answer>
  const answerRe = /<answer>([\s\S]*?)<\/answer>/i;
  const answerMatch = content.match(answerRe);
  if (answerMatch) {
    result.answer = answerMatch[1].trim();
  } else {
    const answerOpen = content.match(/<answer>([\s\S]*)/i);
    if (answerOpen) result.answer = answerOpen[1].trim();
  }

  // answer 之外的文本
  const outside = answerMatch
    ? content.slice(0, answerMatch.index!) + content.slice(answerMatch.index! + answerMatch[0].length)
    : (result.answer ? '' : content);

  // 通用 extract（含未闭合兜底，支持多标签别名）
  const extract = (tags: string[], source: string): string => {
    for (const tag of tags) {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const closed = source.match(re);
      if (closed) return closed[1].trim();
    }
    for (const tag of tags) {
      const reOpen = new RegExp(`<${tag}>([\\s\\S]*)`, 'i');
      const open = source.match(reOpen);
      if (open) return open[1].trim();
    }
    return '';
  };

  result.think = extract(['think', 'thinking'], outside);
  result.note = extract(['note'], outside);

  // 提取 <action>
  const actionRe = /<action\s+[^>]*?\btool\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/action>/gi;
  let m;
  while ((m = actionRe.exec(outside)) !== null) {
    const tool = m[1].trim();
    const jsonStr = m[2].trim();
    let args: Record<string, string> = {};
    try { args = JSON.parse(jsonStr); } catch { args = { _raw: jsonStr }; }
    result.actions.push({ tool, args });
  }

  return result;
}
