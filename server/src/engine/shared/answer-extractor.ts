/**
 * 协议修复 + Answer 提取
 *
 * 模型在长上下文 / 大量工具调用后会破协议：
 * - 自然语言流到 <answer> 标签外
 * - <answer> 标签未闭合（输出截断）
 * - 跟着 </action> 后输出一段未包标签的文字
 * - 把答案直接写进 <think>，忘记输出 <answer>（最常见）
 *
 * 本模块按优先级回退提取 answer，保证发到前端的 answer 字段永远规整。
 *
 * 使用方式：
 *   import { extractAnswer } from '../shared/answer-extractor';
 *   const answer = extractAnswer(rawLLMContent);
 *   if (answer !== null) { ... 命中 answer，发 SSE answer 事件 }
 */

/** 标签外裸文本被视为 answer 的最小字符数（提高阈值减少误报） */
const NAKED_TEXT_MIN_LENGTH = 30;

/** think 内容被视为 answer 的最小字符数 */
const THINK_AS_ANSWER_MIN_LENGTH = 50;

/**
 * 提取 answer，按优先级回退：
 *   1. 完整 <answer>...</answer>
 *   2. 未闭合 <answer>... （流式截断或模型漏写收尾）
 *   3. 剥掉 <think>/<action>/残缺标签后的纯文本（≥ NAKED_TEXT_MIN_LENGTH）
 *   4. <think> 内容（≥ THINK_AS_ANSWER_MIN_LENGTH，且无 action）
 *   5. 都没有 → 返回 null
 *
 * @returns answer 字符串（已 trim）；null 表示真的没有可用内容
 */
export function extractAnswer(content: string): string | null {
  if (!content || !content.trim()) return null;

  // 优先级 1: 完整 <answer>...</answer>
  const closedMatch = /<answer>([\s\S]*?)<\/answer>/i.exec(content);
  if (closedMatch) {
    const text = closedMatch[1].trim();
    if (text) return text;
  }

  // 优先级 2: 未闭合 <answer>... （取到末尾）
  const openMatch = /<answer>([\s\S]*)$/i.exec(content);
  if (openMatch) {
    const text = openMatch[1].trim();
    if (text && !/<answer>/i.test(text)) {
      return text;
    }
  }

  // 优先级 3: 标签外的纯文本兜底
  const naked = stripAllKnownTags(content).trim();
  if (naked.length >= NAKED_TEXT_MIN_LENGTH) {
    return naked;
  }

  // 优先级 4: think 兜底（模型把答案写进 think 里）
  // 只在「有非空 think + 无 action + 没有任何 answer 标签」时触发
  const hasAction = /<action\s+[^>]*>/i.test(content);
  const hasAnyAnswer = /<answer>/i.test(content);
  if (!hasAction && !hasAnyAnswer) {
    const thinkMatch = /<think>([\s\S]*?)<\/think>/i.exec(content);
    if (thinkMatch) {
      const thinkText = thinkMatch[1].trim();
      if (thinkText.length >= THINK_AS_ANSWER_MIN_LENGTH) {
        return thinkText;
      }
    }
  }

  return null;
}

/**
 * 剥离已知协议标签，返回标签外的纯文本。
 *
 * 处理：
 * - 完整闭合的 <think> <action> <answer> <note> <result>
 * - 未闭合的 <action ... >  (从 <action 开始的截断)
 * - 残缺标签字面量（如 </answer> 单独出现）
 */
function stripTagsFromTextSegment(text: string): string {
  let t = text;

  // 闭合标签：think / answer / action / note / result
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<answer>[\s\S]*?<\/answer>/gi, '');
  t = t.replace(/<action\s+[^>]*>[\s\S]*?<\/action>/gi, '');
  t = t.replace(/<note>[\s\S]*?<\/note>/gi, '');
  t = t.replace(/<result[^>]*>[\s\S]*?<\/result>/gi, '');

  // 未闭合开标签：从 <action 开始到末尾（流式截断常见）
  t = t.replace(/<action\s+[^>]*>[\s\S]*$/i, '');
  t = t.replace(/<think>[\s\S]*$/i, '');

  // 残缺标签字面量（孤立 < / > 结尾）
  t = t.replace(/<\/?(?:think|answer|action|note|result)[^>]*>/gi, '');

  return t;
}

export function stripAllKnownTags(content: string): string {
  // 关键：先切出代码块（``` 围栏 + 行内 `code`）加以保护，只在代码块外剥标签。
  // 否则模型在正文里「引用」协议标签当例子时，未闭合的 <action> 会触发贪婪正则
  // 把其后全部内容删到末尾，造成内容被截断（与前端 parser.stripAllKnownTags 对齐）。
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

/**
 * 检测内容是否"看起来"在 <answer> 标签里（用于流式渲染）。
 * 即使标签未闭合也算（流式中标签可能正在生成）。
 */
export function hasAnswerSection(content: string): boolean {
  return /<answer>/i.test(content);
}
