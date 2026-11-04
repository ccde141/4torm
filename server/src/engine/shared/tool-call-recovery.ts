import type { ContextMessage } from './types.js';

/** Recognize a leaked model template, never interpret its arguments as executable input. */
export function unexecutedToolCall(content: string, allowed: ReadonlySet<string>): string | undefined {
  const visible = content.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`\n]*`|^\s*>[^\n]*/gm, ' ');
  const match = /<tool_call>\s*([\w.:-]+)\s*<arg_key>[\s\S]*$/i.exec(visible);
  return match && allowed.has(match[1]) ? match[1] : undefined;
}

export function toolReplyDisplayText(content: string, allowed: ReadonlySet<string>): string {
  return unexecutedToolCall(content, allowed)
    ? content.slice(0, content.toLowerCase().indexOf('<tool_call>')).trimEnd() : content;
}

/** Only re-request the model response. No tool from the malformed text is executed or replayed. */
export class ToolCallRecovery {
  private attempts = 0;
  retry(messages: ContextMessage[], native: boolean): boolean {
    if (++this.attempts > 2) return false;
    messages.push({ role: 'user', origin: 'framework', content: native
      ? '[系统提示：工具调用格式修正] 上一条正文中的 XML 工具标记没有执行。需要操作时，请通过本轮已提供的原生工具接口重新提交完整参数；不要在正文中输出工具调用标记。若只是解释示例，请用代码块引用并明确说明。'
      : '[系统提示：工具调用格式修正] 上一条正文中的 XML 工具标记没有执行。需要操作时，整条回复只能是 {"type":"tool_call","name":"工具名","arguments":{完整参数}}；不要使用 XML 标记。若只是解释示例，请用代码块引用并明确说明。' });
    return true;
  }
}
