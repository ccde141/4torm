import type { ToolDef } from '../store/tools';

export interface ParsedRound {
  think: string;
  actions: Array<{ tool: string; args: Record<string, string> }>;
  answer: string;
  note: string;
  /**
   * answer 来源：
   *   'closed'      完整 <answer>...</answer>
   *   'open'        未闭合 <answer>...
   *   'from-think'  think 长 + 无 answer，把 think 内容当 answer
   *   'recovered'   裸文本兜底（标签外纯文本，最严重的协议崩坏）
   *   undefined     无 answer
   */
  answerSource?: 'closed' | 'open' | 'from-think' | 'recovered';
}

/** 标签外裸文本被视为 answer 的最小字符数（提高阈值减少过渡期误报） */
const NAKED_TEXT_MIN_LENGTH = 30;

/** think 内容被视为 answer 的最小字符数（避免过短 think 误判） */
const THINK_AS_ANSWER_MIN_LENGTH = 50;

/** 对单段非代码文本剥离协议标签（含未闭合截断标签 + 残缺标签字面量）。 */
function stripTagsFromTextSegment(text: string): string {
  let t = text;
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<answer>[\s\S]*?<\/answer>/gi, '');
  t = t.replace(/<action\s+[^>]*>[\s\S]*?<\/action>/gi, '');
  t = t.replace(/<note>[\s\S]*?<\/note>/gi, '');
  t = t.replace(/<result[^>]*>[\s\S]*?<\/result>/gi, '');
  t = t.replace(/<action\s+[^>]*>[\s\S]*$/i, '');
  t = t.replace(/<think>[\s\S]*$/i, '');
  t = t.replace(/<\/?(?:think|answer|action|note|result)[^>]*>/gi, '');
  return t;
}

/**
 * 剥离已知协议标签，返回标签外的纯文本。与后端 answer-extractor.stripAllKnownTags 行为对齐。
 *
 * 关键：先切出代码块（``` 围栏 + 行内 `code`）加以保护，只在代码块外剥标签。
 * 否则模型在正文里「引用」协议标签当例子（尤其讨论框架自身时），未闭合的
 * <action> 会触发贪婪正则把其后全部内容删到末尾，造成内容被截断。
 */
export function stripAllKnownTags(content: string): string {
  const re = /```[\s\S]*?```|`[^`\n]+`/g;
  let out = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out += stripTagsFromTextSegment(content.slice(lastIndex, m.index));
    out += m[0]; // 代码块原样保留
    lastIndex = m.index + m[0].length;
  }
  out += stripTagsFromTextSegment(content.slice(lastIndex));
  return out;
}

export function parseStructuredOutput(
  content: string,
  toolDefs: ToolDef[],
  opts?: { native?: boolean },
): ParsedRound {
  const round: ParsedRound = { think: '', actions: [], answer: '', note: '' };

  // ── answer 三档回退提取 ──
  // 1. 完整 <answer>...</answer>
  const answerClosed = /<answer>([\s\S]*?)<\/answer>/i.exec(content);
  // 2. 未闭合 <answer>... 取到末尾
  const answerOpen = !answerClosed ? /<answer>([\s\S]*)$/i.exec(content) : null;

  if (answerClosed) {
    round.answer = answerClosed[1].trim();
    round.answerSource = 'closed';
  } else if (answerOpen) {
    round.answer = answerOpen[1].trim();
    round.answerSource = 'open';
  }

  // answer 内部可能混入 <note>（模型协议不规范），提取并剥离
  if (round.answer) {
    const noteInAnswer = /<note>([\s\S]*?)<\/note>/i.exec(round.answer);
    if (noteInAnswer) {
      round.note = noteInAnswer[1].trim();
      round.answer = round.answer.replace(/<note>[\s\S]*?<\/note>/gi, '').trim();
    }
  }

  // 标签外的内容（用于提取 think/note/action）
  const outside = answerClosed
    ? content.slice(0, answerClosed.index!) + content.slice(answerClosed.index! + answerClosed[0].length)
    : (answerOpen ? content.slice(0, answerOpen.index!) : content);

  const extract = (tag: string, source: string) => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const closed = source.match(re);
    if (closed) return closed[1].trim();
    const reOpen = new RegExp(`<${tag}>([\\s\\S]*)`, 'i');
    const open = source.match(reOpen);
    if (open) return open[1].trim();
    return '';
  };

  round.think = extract('think', outside) || extract('thinking', outside);
  // 仅在 answer 内没有找到 note 时，从 outside 提取
  if (!round.note) round.note = extract('note', outside);

  let m;
  // 原生模式：真实工具调用走结构化 tool_calls → toolSteps，正文里不该有 <action>。
  // 跳过正文扫描，避免把模型幻觉/引用的 <action>（含 delegate）误判成调用。
  if (!opts?.native) {
    const actionRegex = /<action\s+[^>]*?\btool\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/action>/gi;
    // 内部工具：不走 toolDefs 注册，解析器硬编码识别
    const INTERNAL_TOOLS = new Set(['delegate']);
    while ((m = actionRegex.exec(outside)) !== null) {
      const tool = m[1].trim();
      const jsonStr = m[2].trim();
      if (INTERNAL_TOOLS.has(tool.toLowerCase()) || toolDefs.some(t => t.name.toLowerCase() === tool.toLowerCase())) {
        // JSON 解析失败：不再兜底成 { _raw }（那会渲染出残缺"幽灵卡"，
        // 如 Windows 路径 \A 破坏 JSON）。跳过该 action，宁可不显示也不显示错的。
        try {
          const args = JSON.parse(jsonStr) as Record<string, string>;
          round.actions.push({ tool, args });
        } catch { /* 残缺 JSON → 跳过 */ }
      }
    }

    if (round.actions.length === 0) {
      const legacyRegex = /[🔧📋]\s*(\w[\w_-]*)\s*\(\s*(\{(?:[^{}]|\{[^{}]*\})*\})\s*\)/g;
      while ((m = legacyRegex.exec(outside)) !== null) {
        const tool = m[1].trim();
        const jsonStr = m[2].trim();
        if (toolDefs.some(t => t.name.toLowerCase() === tool.toLowerCase())) {
          try {
            const args = JSON.parse(jsonStr) as Record<string, string>;
            round.actions.push({ tool, args });
          } catch { /* 残缺 JSON → 跳过 */ }
        }
      }
    }
  }

  // 3. 裸文本兜底：answer 没命中但有标签外纯文本 → 视为 answer
  if (!round.answer) {
    const naked = stripAllKnownTags(content).trim();
    if (naked.length >= NAKED_TEXT_MIN_LENGTH) {
      round.answer = naked;
      round.answerSource = 'recovered';
    }
  }

  // 4. think 长但 answer 空：模型把答案写在 think 里了
  // （避免内容被折叠埋藏，把 think 内容拷一份到 answer）
  if (!round.answer && round.think.length >= THINK_AS_ANSWER_MIN_LENGTH && round.actions.length === 0) {
    round.answer = round.think;
    round.answerSource = 'from-think';
    // think 字段保留原样（用户可对比展开看），但 answer 优先显示
  }

  return round;
}

export function extractResult(content: string): string {
  const m = content.match(/<result>([\s\S]*?)<\/result>/i);
  return m?.[1]?.trim() || '';
}
