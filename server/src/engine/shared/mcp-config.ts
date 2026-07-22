import type { McpRemoteConfig, McpServerConfig, McpStdioConfig, McpTransport } from './mcp-types.js';

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少 ${field}`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`);
  return value.trim() || undefined;
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  const input = objectValue(value, field);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string') throw new Error(`${field}.${key} 必须是字符串`);
    if (key.trim()) output[key.trim()] = item;
  }
  return output;
}

function stringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('args 必须是字符串数组');
  }
  return [...value] as string[];
}

function transportValue(value: unknown): McpTransport {
  if (value === undefined) return 'stdio';
  if (value === 'stdio' || value === 'streamable-http' || value === 'sse') return value;
  throw new Error(`不支持的 MCP transport：${String(value)}`);
}

function normalizeStdio(input: Record<string, unknown>, base: Pick<McpStdioConfig, 'name' | 'enabled'>): McpStdioConfig {
  return {
    ...base,
    transport: 'stdio',
    command: requiredString(input.command, 'command'),
    args: stringArray(input.args),
    env: stringRecord(input.env, 'env'),
    ...(optionalString(input.cwd, 'cwd') ? { cwd: optionalString(input.cwd, 'cwd') } : {}),
    ...(input.autoWorkspaces === true ? { autoWorkspaces: true } : {}),
  };
}

function normalizeRemote(input: Record<string, unknown>, base: Pick<McpRemoteConfig, 'name' | 'enabled'>, transport: 'streamable-http' | 'sse'): McpRemoteConfig {
  const url = requiredString(input.url, 'url');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('url 只支持 http 或 https');
  return { ...base, transport, url: parsed.toString(), headers: stringRecord(input.headers, 'headers') };
}

export function normalizeMcpConfig(value: unknown): McpServerConfig {
  const input = objectValue(value, 'MCP 配置');
  const base = {
    name: requiredString(input.name, 'name'),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
  };
  const transport = transportValue(input.transport);
  return transport === 'stdio'
    ? normalizeStdio(input, base)
    : normalizeRemote(input, base, transport);
}
