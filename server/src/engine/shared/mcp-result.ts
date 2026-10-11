import type { McpToolOutcome } from './mcp-types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatBlock(value: unknown): string {
  if (!isObject(value)) return JSON.stringify(value);
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'image') {
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '未知格式';
    return `（MCP 返回了 ${mimeType} 图片；当前 4torm 暂不支持将图片内容转发给模型）`;
  }
  if (value.type === 'audio') {
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '未知格式';
    return `（MCP 返回了 ${mimeType} 音频；当前 4torm 暂不支持将音频内容转发给模型）`;
  }
  return JSON.stringify(value);
}

export function formatMcpToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return JSON.stringify(value);
  if (!Array.isArray(value.content)) return JSON.stringify(value);
  return value.content.map(formatBlock).filter(Boolean).join('\n');
}

export function readMcpToolOutcome(value: unknown): McpToolOutcome {
  if (isObject(value) && value.isError !== undefined && typeof value.isError !== 'boolean') {
    throw new Error('MCP tools/call isError 必须是布尔值');
  }
  return { result: formatMcpToolResult(value), ok: !isObject(value) || value.isError !== true };
}
