import { createMcpClient } from './mcp-client.js';
import { readMcpConfigs, watchMcpConfigs } from './mcp-config-store.js';
import { withAutomaticWorkspaces } from './mcp-workspaces.js';
import type { McpClient, McpInvocationOptions, McpServerConfig, McpToolDef, McpToolOutcome } from './mcp-types.js';
import type { ToolDef } from './tool-defs-loader.js';
import { persistMcpToolOutcome } from './tool-media-store.js';
import { assertAgentToolAccess } from './tool-authorization.js';

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
const pendingClients = new Map<string, McpClient>();
const connectionGenerations = new Map<string, number>();
let nextGeneration = 0;
let managerGeneration = 0;
const toolPool = new Map<string, McpToolEntry>();
const knownConfigs = new Map<string, McpServerConfig>();
const clientDataDirectories = new Map<string, string>();
let stopWatching: (() => void) | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let healthCheckGeneration: number | null = null;
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
  const generation = ++nextGeneration;
  connectionGenerations.set(config.name, generation);
  knownConfigs.set(config.name, config);
  const client = createMcpClient(await effectiveConfig(config, dataDir));
  if (connectionGenerations.get(config.name) !== generation) { client.disconnect(); return; }
  pendingClients.set(config.name, client);
  client.on('log', message => console.log(message));
  client.on('disconnected', info => onDisconnected(config.name, client, info.intentional));
  try {
    await client.connect();
    const current = (await readMcpConfigs(dataDir)).find(item => item.name === config.name && item.enabled);
    if (connectionGenerations.get(config.name) !== generation
      || JSON.stringify(current) !== JSON.stringify(config)) {
      client.disconnect();
      return;
    }
    pendingClients.delete(config.name);
    clients.set(config.name, client);
    clientDataDirectories.set(config.name, dataDir);
    addTools(config.name, client);
    console.log(`[MCP] ${config.name} connected — ${client.tools.length} tools`);
  } catch (error) {
    client.disconnect();
    if (connectionGenerations.get(config.name) !== generation) return;
    throw error;
  } finally {
    if (pendingClients.get(config.name) === client) pendingClients.delete(config.name);
  }
}

function onDisconnected(name: string, client: McpClient, intentional: boolean): void {
  if (clients.get(name) !== client) return;
  purgeTools(name);
  clients.delete(name);
  clientDataDirectories.delete(name);
  if (!intentional) console.error(`[MCP] ${name} 连接已断开`);
}

function disconnectRuntime(name: string): void {
  connectionGenerations.delete(name);
  const pending = pendingClients.get(name);
  pendingClients.delete(name);
  pending?.disconnect();
  const client = clients.get(name);
  if (client) client.disconnect();
  clients.delete(name);
  clientDataDirectories.delete(name);
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
  shutdownMcpManager();
  const generation = ++managerGeneration;
  for (const config of await readMcpConfigs(dataDir)) {
    if (managerGeneration !== generation) return;
    if (!config.enabled) continue;
    try { await connectServer(dataDir, config); }
    catch (error) { console.error(`[MCP] ${config.name} 连接失败:`, (error as Error).message); }
  }
  if (managerGeneration !== generation) return;
  stopWatching = watchMcpConfigs(dataDir, () => {
    void reconcile(dataDir).catch(error => console.error('[MCP] 配置对账失败:', (error as Error).message));
  });
  startHealthCheck(dataDir, generation);
}

export function shutdownMcpManager(): void {
  managerGeneration++;
  stopWatching?.();
  stopWatching = null;
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  healthCheckGeneration = null;
  for (const name of new Set([...connectionGenerations.keys(), ...clients.keys(), ...pendingClients.keys()])) {
    disconnectRuntime(name);
  }
  clients.clear();
  toolPool.clear();
  knownConfigs.clear();
  clientDataDirectories.clear();
}

async function reconcile(dataDir: string): Promise<void> {
  const generation = managerGeneration;
  const desired = new Map(
    (await readMcpConfigs(dataDir)).filter(item => item.enabled).map(item => [item.name, item]),
  );
  if (generation !== managerGeneration) return;
  for (const name of new Set([...clients.keys(), ...knownConfigs.keys()])) {
    if (!desired.has(name)) disconnectServer(name);
  }
  for (const [name, config] of desired) {
    if (generation !== managerGeneration) return;
    const known = knownConfigs.get(name);
    if ((!clients.has(name) && !pendingClients.has(name)) || JSON.stringify(known) !== JSON.stringify(config)) {
      try { await connectServer(dataDir, config); }
      catch (error) { console.error(`[MCP] ${name} 连接失败:`, (error as Error).message); }
    }
  }
}

function startHealthCheck(dataDir: string, generation: number): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    void checkHealth(dataDir, generation).catch(error =>
      console.error('[MCP] 健康检查对账失败:', (error as Error).message));
  }, HEALTH_INTERVAL_MS);
}

async function checkHealth(dataDir: string, generation: number): Promise<void> {
  if (generation !== managerGeneration || healthCheckGeneration === generation) return;
  healthCheckGeneration = generation;
  try {
    for (const [name, client] of [...clients]) {
      if (generation !== managerGeneration) return;
      if (clients.get(name) !== client) continue;
      if (!client.connected) { disconnectRuntime(name); continue; }
      try {
        await client.refreshTools();
        if (clients.get(name) !== client) continue;
        purgeTools(name);
        addTools(name, client);
      } catch (error) {
        if (clients.get(name) !== client) continue;
        console.error(`[MCP] ${name} 健康检查失败:`, (error as Error).message);
        disconnectRuntime(name);
      }
    }
    // Rebuild missing enabled connections once per health cycle. Never replay tools/call.
    if (generation === managerGeneration) await reconcile(dataDir);
  } finally {
    if (healthCheckGeneration === generation) healthCheckGeneration = null;
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

export async function callMcpTool(
  fullName: string, args: Record<string, unknown>, options?: McpInvocationOptions,
): Promise<string> {
  return (await callMcpToolOutcome(fullName, args, options)).result;
}

export async function callMcpToolOutcome(
  fullName: string, args: Record<string, unknown>, options?: McpInvocationOptions,
): Promise<McpToolOutcome> {
  const entry = toolPool.get(fullName);
  if (!entry) throw new Error(`MCP 工具不存在：${fullName}`);
  const client = clients.get(entry.serverName);
  if (!client?.connected) throw new Error(`MCP server ${entry.serverName} 未连接`);
  const dataDir = clientDataDirectories.get(entry.serverName);
  if (!dataDir) throw new Error('MCP 连接缺少图片存储归属');
  options?.signal?.throwIfAborted();
  if (options?.agentId) await assertAgentToolAccess(dataDir, options.agentId, fullName);
  options?.signal?.throwIfAborted();
  if (clients.get(entry.serverName) !== client || toolPool.get(fullName) !== entry) {
    throw new Error(`MCP server ${entry.serverName} 连接已变更，本次调用未执行`);
  }
  const outcome = await client.callToolOutcome(entry.toolName, args, options?.signal);
  return persistMcpToolOutcome(dataDir, outcome);
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
