import type { ToolDef } from './prompt.js';

function renderTool(tool: ToolDef): string {
  const schema = tool.parameters ?? {};
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required)
      ? (schema as { required: string[] }).required
      : [],
  );
  const properties = (schema as {
    properties?: Record<string, { type?: string; description?: string }>;
  }).properties ?? {};
  const parameters = Object.entries(properties).map(([name, value]) => {
    const mark = required.has(name) ? ' [必填]' : ' [可选]';
    return `    ${name}: ${value.type ?? 'string'}${mark} — ${value.description ?? ''}`;
  }).join('\n') || '    无参数';

  return `### ${tool.name}\n  描述: ${tool.description}\n  参数:\n${parameters}`;
}

export function buildTextToolProtocol(tools: ToolDef[]): string {
  const examples = tools[0]
    ? `例如调用 ${tools[0].name}：\n\`\`\`json\n{"type":"tool_call","name":"${tools[0].name}","arguments":{}}\n\`\`\``
    : '';
  return `## 文本工具调用协议

需要调用工具时，整条回复只能是一个 JSON 调用信封：
\`\`\`json
{"type":"tool_call","name":"工具名","arguments":{}}
\`\`\`

${examples}

规则：
- 调用信封外不能包含任何文字，也不要输出思考过程
- 每轮只能调用一个工具；存在依赖的操作分轮执行
- name 必须是下方列出的工具名，arguments 必须是 JSON 对象
- 必填参数不得省略，不得猜测缺失参数
- 工具结果会以 tool_result JSON 返回；收到后继续调用工具或直接回答
- 不需要调用工具时，直接输出普通自然语言作为最终回答，不需要任何包装

## 可用工具

${tools.map(renderTool).join('\n\n')}`;
}
