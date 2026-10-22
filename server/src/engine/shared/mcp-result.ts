import type { McpToolOutcome } from './mcp-types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatBlock(value: unknown, images: NonNullable<McpToolOutcome['inlineImages']>): string {
  if (!isObject(value)) return safeJson(value);
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'image') {
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '未知格式';
    if (typeof value.data !== 'string' || typeof value.mimeType !== 'string') return '（MCP 图片缺少有效类型或内容，未转发。）';
    if (images.length >= 4) return '（MCP 返回的图片超过单次 4 张上限，其余图片未转发。）';
    images.push({ mimeType: value.mimeType, data: value.data });
    return `（MCP 返回了 ${mimeType} 图片。）`;
  }
  if (value.type === 'audio') {
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '未知格式';
    return `（MCP 返回了 ${mimeType} 音频；当前 4torm 暂不支持将音频内容转发给模型）`;
  }
  if (value.type === 'resource' && isObject(value.resource)) {
    const resource = value.resource;
    if (typeof resource.text === 'string') return resource.text;
    return '（MCP 返回了嵌入二进制资源，当前不将其作为文本转发。）';
  }
  if (value.type === 'resource_link') return `（MCP 资源链接：${typeof value.uri === 'string' ? safeValue(value.uri) : '未知地址'}；未自动读取。）`;
  return safeJson(value);
}

export function formatMcpToolResult(value: unknown): string {
  return readMcpToolOutcome(value).result;
}

export function readMcpToolOutcome(value: unknown): McpToolOutcome {
  if (isObject(value) && value.isError !== undefined && typeof value.isError !== 'boolean') {
    throw new Error('MCP tools/call isError 必须是布尔值');
  }
  const inlineImages: NonNullable<McpToolOutcome['inlineImages']> = [];
  const structuredContent = isObject(value) && isObject(value.structuredContent)
    ? safeValue(value.structuredContent) as Record<string, unknown> : undefined;
  const parts = typeof value === 'string' ? [value]
    : isObject(value) && Array.isArray(value.content) ? value.content.map(block => formatBlock(block, inlineImages))
      : structuredContent ? [] : [safeJson(value)];
  if (structuredContent) {
    const serialized = JSON.stringify(structuredContent);
    const duplicate = parts.some(text => {
      if (text.trim() === serialized) return true;
      try { return JSON.stringify(JSON.parse(text)) === serialized; } catch { return false; }
    });
    if (!duplicate) parts.push(serialized);
  }
  return { result: parts.filter(Boolean).join('\n'), ok: !isObject(value) || value.isError !== true,
    ...(structuredContent ? { structuredContent } : {}), ...(inlineImages.length ? { inlineImages } : {}) };
}

function safeJson(value: unknown): string { return JSON.stringify(safeValue(value)) ?? ''; }

/** Unknown metadata may contain embedded binary blocks too; never stringify their bytes. */
function safeValue(value: unknown): unknown {
  if (typeof value === 'string') return /^data:(?:image|audio)\//i.test(value) ? '（二进制内容未作为文本转发）' : value;
  if (Array.isArray(value)) return value.map(safeValue);
  if (!isObject(value)) return value;
  const binary = value.type === 'image' || value.type === 'audio'
    || typeof value.mimeType === 'string' && /^(?:image|audio)\//i.test(value.mimeType);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'blob' || key === 'data' && binary ? '（二进制内容未作为文本转发）' : safeValue(item)]));
}
