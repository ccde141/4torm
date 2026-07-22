export type McpTransport = 'stdio' | 'streamable-http' | 'sse';

export interface McpServer {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  autoWorkspaces?: boolean;
  url?: string;
  headers?: Record<string, string>;
  connected: boolean;
  toolCount: number;
}

export interface KeyValuePair { key: string; value: string; }

export interface McpFormState {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  args: string[];
  env: KeyValuePair[];
  cwd: string;
  autoWorkspaces: boolean;
  url: string;
  headers: KeyValuePair[];
}

export interface McpConfigPayload {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  autoWorkspaces?: boolean;
  url?: string;
  headers?: Record<string, string>;
}

export function emptyMcpForm(): McpFormState {
  return {
    name: '', enabled: true, transport: 'stdio', command: '', args: [], env: [], cwd: '',
    autoWorkspaces: false, url: '', headers: [],
  };
}

function pairs(value: Record<string, string> | undefined): KeyValuePair[] {
  return Object.entries(value || {}).map(([key, item]) => ({ key, value: item }));
}

function pairRecord(value: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(value.filter(pair => pair.key.trim()).map(pair => [pair.key.trim(), pair.value]));
}

export function formFromServer(server: McpServer): McpFormState {
  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command || '',
    args: [...(server.args || [])],
    env: pairs(server.env),
    cwd: server.cwd || '',
    autoWorkspaces: !!server.autoWorkspaces,
    url: server.url || '',
    headers: pairs(server.headers),
  };
}

export function payloadFromForm(form: McpFormState): McpConfigPayload {
  const name = form.name.trim();
  if (!name) throw new Error('名称不能为空');
  if (form.transport === 'stdio') {
    const command = form.command.trim();
    if (!command) throw new Error('启动命令不能为空');
    return {
      name, enabled: form.enabled, transport: 'stdio', command,
      args: [...form.args], env: pairRecord(form.env),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...(form.autoWorkspaces ? { autoWorkspaces: true } : {}),
    };
  }
  const url = form.url.trim();
  if (!url) throw new Error('服务 URL 不能为空');
  return {
    name, enabled: form.enabled, transport: form.transport,
    url, headers: pairRecord(form.headers),
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const input = objectValue(value, label);
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} 必须是字符串`);
  }
  return input as Record<string, string>;
}

function transportValue(value: unknown, hasUrl: boolean): McpTransport {
  if (value === undefined) return hasUrl ? 'streamable-http' : 'stdio';
  if (value === 'http' || value === 'streamable-http' || value === 'streamableHttp') return 'streamable-http';
  if (value === 'sse' || value === 'stdio') return value;
  throw new Error(`不支持的 MCP transport：${String(value)}`);
}

function importedConfig(name: string, value: unknown): McpConfigPayload {
  const input = objectValue(value, `MCP ${name}`);
  const transport = transportValue(input.transport ?? input.type, typeof input.url === 'string');
  const form = emptyMcpForm();
  form.name = typeof input.name === 'string' ? input.name : name;
  form.enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  form.transport = transport;
  if (transport === 'stdio') {
    form.command = typeof input.command === 'string' ? input.command : '';
    if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some(item => typeof item !== 'string'))) {
      throw new Error(`MCP ${name}.args 必须是字符串数组`);
    }
    form.args = input.args ? [...input.args] as string[] : [];
    form.env = pairs(stringRecord(input.env, `MCP ${name}.env`));
    form.cwd = typeof input.cwd === 'string' ? input.cwd : '';
  } else {
    form.url = typeof input.url === 'string' ? input.url : '';
    form.headers = pairs(stringRecord(input.headers, `MCP ${name}.headers`));
  }
  return payloadFromForm(form);
}

export function parseMcpConfigJson(text: string): McpConfigPayload[] {
  const root = objectValue(JSON.parse(text) as unknown, 'MCP JSON');
  const wrapped = root.mcpServers === undefined ? null : objectValue(root.mcpServers, 'mcpServers');
  if (wrapped) return Object.entries(wrapped).map(([name, value]) => importedConfig(name, value));
  const name = typeof root.name === 'string' ? root.name : '';
  if (!name) throw new Error('单项 MCP 配置必须包含 name');
  return [importedConfig(name, root)];
}
