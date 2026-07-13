/**
 * MCP Manager — 全局 MCP server 生命周期管理 + 工具池
 *
 * 职责：
 * - 读取 data/mcp/servers.json 配置
 * - 启动所有 enabled 的 server（McpStdioClient）
 * - 维护全局 MCP 工具列表
 * - 提供 callTool 路由
 * - 单 server 增量连/断、崩溃自动退避重连、健康检查、配置文件热监听
 */

import fs from 'node:fs/promises';
import { watch as fsWatch, mkdirSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { McpStdioClient, type McpServerConfig, type McpToolDef } from './mcp-client';
import type { ToolDef } from './tool-defs-loader';

// ── 类型 ──────────────────────────────────────────────────────────

export interface McpToolEntry {
  /** 全局唯一名称：mcp:{serverName}:{toolName} */
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

// ── 状态 ──────────────────────────────────────────────────────────

const clients = new Map<string, McpStdioClient>();
const toolPool = new Map<string, McpToolEntry>();
/** 期望保持连接的 server 配置（enabled 的），崩溃重连时据此重建 */
const knownConfigs = new Map<string, McpServerConfig>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();

let healthTimer: ReturnType<typeof setInterval> | null = null;
let configWatcher: FSWatcher | null = null;
let watchDebounce: ReturnType<typeof setTimeout> | null = null;
/** initMcpManager 时记下，供 connectServer 做 workspace 自动注入（connectServer 不显式收 dataDir）。 */
let rootDataDir = '';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 8;   // 连续失败上限，超过停止自动重连（可手动重连）
const HEALTH_INTERVAL_MS = 60_000;  // 健康检查间隔

// ── 工具池增删 ────────────────────────────────────────────────────

function purgeTools(serverName: string): void {
  for (const [fullName, entry] of toolPool) {
    if (entry.serverName === serverName) toolPool.delete(fullName);
  }
}

function addTools(serverName: string, client: McpStdioClient): void {
  for (const tool of client.tools) {
    const fullName = `mcp:${serverName}:${tool.name}`;
    toolPool.set(fullName, { fullName, serverName, toolName: tool.name, def: tool });
  }
}

// ── workspace 自动注入（仅 filesystem server）────────────────────

/** 扫描 data 下各子系统的 agent 工作区目录，用于给 filesystem MCP 放行。 */
async function scanWorkspaceDirs(dataDir: string): Promise<string[]> {
  const dirs: string[] = [];
  // 各子系统工作区的父目录 + 该层下的 workspace/.workspace 目录名
  const roots: Array<{ base: string; sub: string }> = [
    { base: 'agents', sub: '.workspace' },
    { base: 'cyclone', sub: 'workspace' },
    { base: 'convection/sessions', sub: 'workspace' },
    { base: 'tradewind/workflows', sub: 'workspace' },
  ];
  for (const { base, sub } of roots) {
    const parent = path.join(dataDir, base);
    let entries: string[];
    try { entries = await fs.readdir(parent); } catch { continue; }
    for (const name of entries) {
      const wsPath = path.join(parent, name, sub);
      try {
        if ((await fs.stat(wsPath)).isDirectory()) dirs.push(wsPath);
      } catch { /* 该实例无 workspace，跳过 */ }
    }
  }
  return dirs;
}

/** 若开启 autoWorkspaces，返回追加了 workspace 目录的 args 副本；否则原样返回。 */
async function withAutoWorkspaces(cfg: McpServerConfig): Promise<string[]> {
  const args = cfg.args || [];
  if (!cfg.autoWorkspaces || !rootDataDir) return args;
  const dirs = await scanWorkspaceDirs(rootDataDir);
  // 去重：已在 args 里的目录不重复追加
  const fresh = dirs.filter(d => !args.includes(d));
  if (fresh.length) console.log(`[MCP] ${cfg.name} 自动放行 ${fresh.length} 个 agent workspace`);
  return [...args, ...fresh];
}

// ── 连接 / 重连 / 断开 ─────────────────────────────────────────────

/** 连接（或重连）单个 server。会先清掉同名旧 client 与待重连定时器。 */
async function connectServer(cfg: McpServerConfig): Promise<void> {
  cancelReconnect(cfg.name);
  knownConfigs.set(cfg.name, cfg);

  // 干净替换旧 client（避免泄漏）
  const existing = clients.get(cfg.name);
  if (existing) { existing.disconnect(); clients.delete(cfg.name); }
  purgeTools(cfg.name);

  // filesystem 自动放行：连接前把 agent workspace 目录拼进 args（不写回配置文件）
  const effectiveCfg: McpServerConfig = { ...cfg, args: await withAutoWorkspaces(cfg) };
  const client = new McpStdioClient(effectiveCfg);
  client.on('log', (msg: string) => console.log(msg));
  client.on('disconnected', (info: { code: number | null; intentional: boolean } | number) => {
    purgeTools(cfg.name);
    const intentional = typeof info === 'object' && info ? info.intentional : false;
    if (intentional) return;                 // 用户主动停用/移除/替换 → 不自起
    if (clients.get(cfg.name) !== client) return; // 已被新 client 取代 → 忽略迟到的退出
    console.warn(`[MCP] ${cfg.name} 意外断开，准备自动重连`);
    scheduleReconnect(cfg.name);
  });

  try {
    await client.connect();
    clients.set(cfg.name, client);
    addTools(cfg.name, client);
    reconnectAttempts.delete(cfg.name); // 成功 → 重置退避
    console.log(`[MCP] ${cfg.name} connected — ${client.tools.length} tools`);
  } catch (e) {
    console.error(`[MCP] ${cfg.name} failed to connect:`, (e as Error).message);
    try { client.disconnect(); } catch { /* ignore */ }
    scheduleReconnect(cfg.name); // 首连失败也退避重试
  }
}

/** 退避排程一次重连 */
function scheduleReconnect(name: string): void {
  const cfg = knownConfigs.get(name);
  if (!cfg || !cfg.enabled) return;          // 已不期望启用
  if (reconnectTimers.has(name)) return;     // 已有排程

  const attempts = (reconnectAttempts.get(name) || 0) + 1;
  if (attempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`[MCP] ${name} 连续重连 ${MAX_RECONNECT_ATTEMPTS} 次失败，停止自动重连（可在 MCP 页手动重连）`);
    return;
  }
  reconnectAttempts.set(name, attempts);
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attempts - 1));
  console.log(`[MCP] ${name} 将在 ${delay}ms 后第 ${attempts}/${MAX_RECONNECT_ATTEMPTS} 次重连`);

  const timer = setTimeout(() => {
    reconnectTimers.delete(name);
    const c = knownConfigs.get(name);
    if (c && c.enabled) connectServer(c);
  }, delay);
  reconnectTimers.set(name, timer);
}

function cancelReconnect(name: string): void {
  const t = reconnectTimers.get(name);
  if (t) { clearTimeout(t); reconnectTimers.delete(name); }
}

/** 主动断开并停止管理单个 server（停用/移除时调用） */
export function disconnectServer(name: string): void {
  cancelReconnect(name);
  knownConfigs.delete(name);
  reconnectAttempts.delete(name);
  const client = clients.get(name);
  if (client) { client.disconnect(); clients.delete(name); }
  purgeTools(name);
}

/** 重连单个 server（从配置文件读最新配置，不影响其他 server） */
export async function reconnectServer(dataDir: string, name: string): Promise<void> {
  const cfg = await readServerConfig(dataDir, name);
  if (!cfg || !cfg.enabled || cfg.transport !== 'stdio') {
    disconnectServer(name);
    return;
  }
  reconnectAttempts.delete(name);
  await connectServer(cfg);
}

// ── 初始化 / 关闭 ──────────────────────────────────────────────────

/** 初始化：读取配置、启动所有 enabled 的 server，并开启热监听 + 健康检查 */
export async function initMcpManager(dataDir: string): Promise<void> {
  rootDataDir = dataDir;   // 记下供 workspace 自动注入
  const configs = await readAllConfigs(dataDir);
  for (const cfg of configs) {
    if (!cfg.enabled || cfg.transport !== 'stdio') continue;
    await connectServer(cfg);
  }
  startConfigWatch(dataDir);
  startHealthCheck();
}

/** 关闭所有连接 + 停止所有定时器 / 监听 */
export function shutdownMcpManager(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (configWatcher) { try { configWatcher.close(); } catch { /* ignore */ } configWatcher = null; }
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
  for (const t of reconnectTimers.values()) clearTimeout(t);
  reconnectTimers.clear();
  reconnectAttempts.clear();
  for (const client of clients.values()) client.disconnect();
  clients.clear();
  toolPool.clear();
  knownConfigs.clear();
}

// ── 配置热监听 ────────────────────────────────────────────────────

/** 监听 data/mcp/ 目录，servers.json 变化时与运行状态做增量对账 */
function startConfigWatch(dataDir: string): void {
  if (configWatcher) return;
  const mcpDir = path.join(dataDir, 'mcp');
  try { mkdirSync(mcpDir, { recursive: true }); } catch { /* ignore */ }
  try {
    configWatcher = fsWatch(mcpDir, (_event, filename) => {
      if (filename && filename !== 'servers.json') return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        reconcile(dataDir).catch(e => console.error('[MCP] 配置对账失败:', (e as Error).message));
      }, 300);
    });
  } catch (e) {
    console.error('[MCP] 无法监听配置目录:', (e as Error).message);
  }
}

/** 把运行中的连接与配置文件对账：新启用→连、停用/删除→断、命令变更→重连 */
async function reconcile(dataDir: string): Promise<void> {
  const configs = await readAllConfigs(dataDir);
  const desired = new Map(
    configs.filter(c => c.enabled && c.transport === 'stdio').map(c => [c.name, c] as const),
  );

  // 停掉：当前连着或在重连排程，但配置里已不再期望的
  for (const name of new Set([...clients.keys(), ...knownConfigs.keys()])) {
    if (!desired.has(name)) disconnectServer(name);
  }

  // 启动 / 更新：期望启用的
  for (const [name, cfg] of desired) {
    const cur = knownConfigs.get(name);
    const running = clients.has(name);
    const changed = !!cur && (
      cur.command !== cfg.command ||
      JSON.stringify(cur.args || []) !== JSON.stringify(cfg.args || []) ||
      JSON.stringify(cur.env || {}) !== JSON.stringify(cfg.env || {})
    );
    if (!running || changed) {
      await connectServer(cfg); // connectServer 内部先断旧再连
    }
  }
}

// ── 健康检查 ──────────────────────────────────────────────────────

/** 定时对已连接 client 做 tools/list 探活；失败则触发重连，顺带刷新工具池 */
function startHealthCheck(): void {
  if (healthTimer) return;
  healthTimer = setInterval(async () => {
    for (const [name, client] of [...clients]) {
      if (!client.connected) continue;
      try {
        await client.refreshTools();
        purgeTools(name);
        addTools(name, client); // 工具增删同步进池
      } catch {
        console.warn(`[MCP] ${name} 健康检查无响应，触发重连`);
        client.disconnect();
        clients.delete(name);
        purgeTools(name);
        scheduleReconnect(name);
      }
    }
  }, HEALTH_INTERVAL_MS);
}

// ── 配置读取 ──────────────────────────────────────────────────────

async function readAllConfigs(dataDir: string): Promise<McpServerConfig[]> {
  try {
    const raw = await fs.readFile(path.join(dataDir, 'mcp', 'servers.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readServerConfig(dataDir: string, name: string): Promise<McpServerConfig | null> {
  return (await readAllConfigs(dataDir)).find(c => c.name === name) || null;
}

// ── 工具池查询 / 调用 ──────────────────────────────────────────────

/** 获取所有 MCP 工具（转为 ToolDef 格式） */
export function getMcpToolDefs(): ToolDef[] {
  return Array.from(toolPool.values()).map(mcpEntryToToolDef);
}

/** 匹配 Agent 配置中的 MCP 工具引用，返回对应的 ToolDef[] */
export function resolveMcpTools(toolNames: string[]): ToolDef[] {
  const result: ToolDef[] = [];
  for (const name of toolNames) {
    // 精确匹配：mcp:serverName:toolName
    if (toolPool.has(name)) {
      result.push(mcpEntryToToolDef(toolPool.get(name)!));
      continue;
    }
    // 通配匹配：mcp:serverName:*
    const wildcardMatch = /^mcp:([^:]+):\*$/.exec(name);
    if (wildcardMatch) {
      const serverName = wildcardMatch[1];
      for (const entry of toolPool.values()) {
        if (entry.serverName === serverName) result.push(mcpEntryToToolDef(entry));
      }
    }
  }
  return result;
}

/** 调用 MCP 工具 */
export async function callMcpTool(fullName: string, args: Record<string, any>): Promise<string> {
  const entry = toolPool.get(fullName);
  if (!entry) throw new Error(`MCP 工具不存在：${fullName}`);
  const client = clients.get(entry.serverName);
  if (!client?.connected) throw new Error(`MCP server ${entry.serverName} 未连接（可能正在重连，稍后重试）`);
  return client.callTool(entry.toolName, args);
}

/** 获取所有 server 状态 */
export function getMcpStatus(): McpServerStatus[] {
  const statuses: McpServerStatus[] = [];
  for (const [name, client] of clients) {
    statuses.push({ name, enabled: true, connected: client.connected, toolCount: client.tools.length });
  }
  return statuses;
}

// ── 辅助 ──

function mcpEntryToToolDef(entry: McpToolEntry): ToolDef {
  return {
    name: entry.fullName,
    description: `[MCP:${entry.serverName}] ${entry.def.description}`,
    category: 'mcp',
    dangerous: false,
    parameters: entry.def.inputSchema ? {
      type: entry.def.inputSchema.type || 'object',
      properties: entry.def.inputSchema.properties,
      required: entry.def.inputSchema.required,
    } : undefined,
    executorType: 'mcp',
  };
}
