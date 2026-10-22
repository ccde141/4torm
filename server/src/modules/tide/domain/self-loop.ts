/**
 * 潮汐 — Self-Loop（自循环）支持
 *
 * v2：砍掉假工具 schedule_next，改为文本标记 [NEXT: ...] 后处理提取。
 * - 不再注入假工具定义到 toolDefs
 * - 不再需要 interceptTool 拦截
 * - runner 从 answer/rawContent 正则提取 [NEXT: ...] 标记
 * - 提取后从 answer 中剥离（用户看不到）
 */

/** 自循环提示词追加段（拼到 rolePrompt 末尾） */
export const SELF_LOOP_INSTRUCTION =
  '\n\n# 自循环模式\n' +
  '你是一个常驻值班的 agent，系统会按固定节奏唤醒你执行任务。\n' +
  '每次唤醒时，你收到的消息就是本轮的任务指令。\n\n' +
  '## 工作流程\n' +
  '1. 正常完成本轮任务（调用工具、分析、回答等）\n' +
  '2. 在你最终回答的末尾，另起一行用标记交出下一轮任务：\n' +
  '   [NEXT: 下一轮你要做什么的简要描述]\n\n' +
  '## 示例\n' +
  '```\n' +
  '已检查完毕，未发现新的异常条目。\n' +
  '\n' +
  '[NEXT: 再次检查是否有新增条目，重点关注错误日志]\n' +
  '```\n\n' +
  '## 规则\n' +
  '- [NEXT: ...] 必须独占最终回答的最后一行\n' +
  '- 内容要具体，不要写"继续"之类的空话\n' +
  '- 如果本轮工作让你发现了新方向，把新方向写进去\n' +
  '- 如果确实无事可做，描述下次要检查什么\n' +
  '- 你不会因"事情做完"而停止；停止只由人类暂停任务决定';

/**
 * 从 answer 文本中提取 [NEXT: ...] 标记。
 * 返回 { next, cleaned }：
 *   next: 提取到的下一轮 prompt（null 表示未找到）
 *   cleaned: 剥离标记后的 answer（展示给用户）
 */
export function extractNextPrompt(answer: string): {
  next: string | null;
  cleaned: string;
} {
  const lines = answer.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && !lines[last]!.trim()) last--;
  if (last < 0) return { next: null, cleaned: answer };
  // A marker inside an example/code block is data, not the next task.
  let fence: { char: string; length: number } | undefined;
  for (const line of lines.slice(0, last)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const run = match[1]!;
    if (!fence) fence = { char: run[0]!, length: run.length };
    else if (run[0] === fence.char && run.length >= fence.length && !match[2]!.trim()) fence = undefined;
  }
  const match = /^[ \t]*\[NEXT:[ \t]*([^\r\n]+)\][ \t]*$/i.exec(lines[last]!);
  const next = match?.[1]?.trim();
  if (fence || !next) return { next: null, cleaned: answer };
  return { next, cleaned: answer.slice(0, answer.trimEnd().length - lines[last]!.trimEnd().length).trimEnd() };
}
