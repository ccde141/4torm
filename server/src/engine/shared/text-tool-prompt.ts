import type { ToolDef } from './prompt.js';

const MAX_TOOL_DESCRIPTION_CHARS = 500;
const MAX_PARAMETER_DESCRIPTION_CHARS = 160;

function compactSchema(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, (key, value: unknown) => (
    key === 'description' && typeof value === 'string'
      ? value.slice(0, MAX_PARAMETER_DESCRIPTION_CHARS) : value
  ));
}

function needsFullSchema(schema: Record<string, unknown>): boolean {
  if (schema.type !== undefined && schema.type !== 'object') return true;
  if (Object.keys(schema).some(key => !['type', 'properties', 'required'].includes(key))) return true;
  if (schema.properties === undefined) return false;
  if (!schema.properties || typeof schema.properties !== 'object'
    || Array.isArray(schema.properties)) return true;
  return Object.values(schema.properties).some(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
    const property = value as Record<string, unknown>;
    return Object.keys(property).some(key => !['type', 'description'].includes(key))
      || (property.type !== undefined && typeof property.type !== 'string')
      || (property.description !== undefined && typeof property.description !== 'string');
  });
}

function renderTool(tool: ToolDef): string {
  const schema = tool.parameters ?? {};
  const header = `### ${tool.name}\n  描述: ${tool.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS)}`;
  if (needsFullSchema(schema)) return `${header}\n  参数 JSON Schema: ${compactSchema(schema)}`;
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required)
      ? (schema as { required: string[] }).required
      : [],
  );
  const properties = (schema as {
    properties?: Record<string, unknown>;
  }).properties ?? {};
  const parameters = Object.entries(properties).map(([name, value]) => {
    const property = value && typeof value === 'object'
      ? value as Record<string, unknown> : {};
    const mark = required.has(name) ? ' [必填]' : ' [可选]';
    const type = typeof property.type === 'string' ? property.type : 'string';
    const description = typeof property.description === 'string'
      ? property.description.slice(0, MAX_PARAMETER_DESCRIPTION_CHARS) : '';
    return `    ${name}: ${type}${mark} — ${description}`;
  }).join('\n') || '    无参数';

  return `${header}\n  参数:\n${parameters}`;
}

export function buildTextToolProtocol(tools: ToolDef[]): string {
  const definitions = tools.map(renderTool).join('\n\n');
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

${definitions}`;
}
