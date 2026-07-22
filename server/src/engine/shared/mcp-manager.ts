import { createMcpClient } from './mcp-client.js';
import { readMcpConfigs, watchMcpConfigs } from './mcp-config-store.js';
import { withAutomaticWorkspaces } from './mcp-workspaces.js';
import type { McpClient, McpServerConfig, McpToolDef } from './mcp-types.js';
import type { ToolDef } from './tool-defs-loader.js';

export interface McpToolEntry {
  fullName: string;
  serverName: string;
  toolName: string;
  def: McpToolDef;
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
}

const clients = new Map<string, McpClient>();
const toolPool = new Map<string, McpToolEntry>();
const knownConfigs = new Map<string, McpServerConfig>();
let stopWatching: (() => void) | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_INTERVAL_MS = 60_000;

function purgeTools(serverName: string): void {
  for (const [fullName, entry] of toolPool) {
    if (entry.serverName === serverName) toolPool.delete(fullName);
  }
}

function addTools(serverName: string, client: McpClient): void {
  for (const tool of client.tools) {
    const fullName = `mcp:${serverName}:${tool.name}`;
    toolPool.set(fullName, { fullName, serverName, toolName: tool.name, def: tool });
  }
}

async function effectiveConfig(config: McpServerConfig, dataDir: string): Promise<McpServerConfig> {
  return config.transport === 'stdio' ? withAutomaticWorkspaces(config, dataDir) : config;
}

async function connectServer(dataDir: string, config: McpServerConfig): Promise<void> {
  disconnectRuntime(config.name);
  knownConfigs.set(config.name, config);
  const client = createMcpClient(await effectiveConfig(config, dataDir));
  client.on('log', message => console.log(message));
  client.on('disconnected', info => onDisconnected(config.name, client, info.intentional));
  try {
    await client.connect();
    clients.set(config.name, client);
    addTools(config.name, client);
    console.log(`[MCP] ${config.name} connected — ${client.tools.length} tools`);
  } catch (error) {
    client.disconnect();
    knownConfigs.set(config.name, config);
    throw error;
  }
}

function onDisconnected(name: string, client: McpClient, intentional: boolean): void {
  purgeTools(name);
  if (clients.get(name) === client) clients.delete(name);
  if (!intentional) console.error(`[MCP] ${name} 连接已断开`);
}

function disconnectRuntime(name: string): void {
  const client = clients.get(name);
  if (client) client.disconnect();
  clients.delete(name);
  purgeTools(name);
}

export function disconnectServer(name: string): void {
  disconnectRuntime(name);
  knownConfigs.delete(name);
}

export async function reconnectServer(dataDir: string, name: string): Promise<void> {
  const config = (await readMcpConfigs(dataDir)).find(item => item.name === name);
  if (!config || !config.enabled) { disconnectServer(name); return; }
  await connectServer(dataDir, config);
}

export async function initMcpManager(dataDir: string): Promise<void> {
  for (const config of await readMcpConfigs(dataDir)) {
    if (!config.enabled) continue;
    try { await connectServer(dataDir, config); }
    catch (error) { console.error(`[MCP] ${config.name} 连接失败:`, (error as Error).message); }
  }
  stopWatching = watchMcpConfigs(dataDir, () => {
    void reconcile(dataDir).catch(error => console.error('[MCP] 配置对账失败:', (error as Error).message));
  });
  startHealthCheck();
}

export function shutdownMcpManager(): void {
  stopWatching?.();
  stopWatching = null;
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  for (const client of clients.values()) client.disconnect();
  clients.clear();
  toolPool.clear();
  knownConfigs.clear();
}

async function reconcile(dataDir: string): Promise<void> {
  const desired = new Map(
    (await readMcpConfigs(dataDir)).filter(item => item.enabled).map(item => [item.name, item]),
  );
  for (const name of new Set([...clients.keys(), ...knownConfigs.keys()])) {
    if (!desired.has(name)) disconnectServer(name);
  }
  for (const [name, config] of desired) {
    const known = knownConfigs.get(name);
    if (!clients.has(name) || JSON.stringify(known) !== JSON.stringify(config)) {
      try { await connectServer(dataDir, config); }
      catch (error) { console.error(`[MCP] ${name} 连接失败:`, (error as Error).message); }
    }
  }
}

function startHealthCheck(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => void checkHealth(), HEALTH_INTERVAL_MS);
}

async function checkHealth(): Promise<void> {
  for (const [name, client] of [...clients]) {
    if (!client.connected) continue;
    try {
      await client.refreshTools();
      purgeTools(name);
      addTools(name, client);
    } catch (error) {
      console.error(`[MCP] ${name} 健康检查失败:`, (error as Error).message);
      disconnectRuntime(name);
    }
  }
}

export function getMcpToolDefs(): ToolDef[] {
  return Array.from(toolPool.values()).map(mcpEntryToToolDef);
}

export function resolveMcpTools(toolNames: string[]): ToolDef[] {
  const result: ToolDef[] = [];
  for (const name of toolNames) {
    const exact = toolPool.get(name);
    if (exact) { result.push(mcpEntryToToolDef(exact)); continue; }
    const wildcard = /^mcp:([^:]+):\*$/.exec(name);
    if (!wildcard) continue;
    for (const entry of toolPool.values()) {
      if (entry.serverName === wildcard[1]) result.push(mcpEntryToToolDef(entry));
    }
  }
  return result;
}

export async function callMcpTool(fullName: string, args: Record<string, unknown>): Promise<string> {
  const entry = toolPool.get(fullName);
  if (!entry) throw new Error(`MCP 工具不存在：${fullName}`);
  const client = clients.get(entry.serverName);
  if (!client?.connected) throw new Error(`MCP server ${entry.serverName} 未连接`);
  return client.callTool(entry.toolName, args);
}

export function getMcpStatus(): McpServerStatus[] {
  return [...clients].map(([name, client]) => ({
    name, enabled: true, connected: client.connected, toolCount: client.tools.length,
  }));
}

function mcpEntryToToolDef(entry: McpToolEntry): ToolDef {
  return {
    name: entry.fullName,
    description: `[MCP:${entry.serverName}] ${entry.def.description}`,
    category: 'mcp', dangerous: false,
    parameters: entry.def.inputSchema,
    executorType: 'mcp',
  };
}
