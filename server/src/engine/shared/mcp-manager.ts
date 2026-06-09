/**
 * MCP Manager — 全局 MCP server 生命周期管理 + 工具池
 *
 * 职责：
 * - 读取 data/mcp/servers.json 配置
 * - 启动所有 enabled 的 server（McpStdioClient）
 * - 维护全局 MCP 工具列表
 * - 提供 callTool 路由
 *
 * 单文件 ≤ 300 行
 */

import fs from 'node:fs/promises';
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

// ── Manager ──────────────────────────────────────────────────────

const clients = new Map<string, McpStdioClient>();
const toolPool = new Map<string, McpToolEntry>();

/** 初始化：读取配置、启动所有 enabled 的 server */
export async function initMcpManager(dataDir: string): Promise<void> {
  const configPath = path.join(dataDir, 'mcp', 'servers.json');
  let configs: McpServerConfig[] = [];
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    configs = JSON.parse(raw);
  } catch {
    // 配置文件不存在或无效，跳过
    return;
  }

  for (const cfg of configs) {
    if (!cfg.enabled || cfg.transport !== 'stdio') continue;
    await connectServer(cfg);
  }
}

/** 连接单个 server */
async function connectServer(cfg: McpServerConfig): Promise<void> {
  const client = new McpStdioClient(cfg);
  client.on('log', (msg: string) => console.log(msg));
  client.on('disconnected', () => {
    // 移除该 server 的工具
    for (const [fullName, entry] of toolPool) {
      if (entry.serverName === cfg.name) toolPool.delete(fullName);
    }
  });

  try {
    await client.connect();
    clients.set(cfg.name, client);
    // 注册工具
    for (const tool of client.tools) {
      const fullName = `mcp:${cfg.name}:${tool.name}`;
      toolPool.set(fullName, { fullName, serverName: cfg.name, toolName: tool.name, def: tool });
    }
    console.log(`[MCP] ${cfg.name} connected — ${client.tools.length} tools`);
  } catch (e) {
    console.error(`[MCP] ${cfg.name} failed to connect:`, (e as Error).message);
  }
}

/** 获取所有 MCP 工具（转为 ToolDef 格式） */
export function getMcpToolDefs(): ToolDef[] {
  return Array.from(toolPool.values()).map(entry => ({
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
  }));
}

/** 匹配 Agent 配置中的 MCP 工具引用，返回对应的 ToolDef[] */
export function resolveMcpTools(toolNames: string[]): ToolDef[] {
  const result: ToolDef[] = [];
  for (const name of toolNames) {
    // 精确匹配：mcp:serverName:toolName
    if (toolPool.has(name)) {
      const entry = toolPool.get(name)!;
      result.push(mcpEntryToToolDef(entry));
      continue;
    }
    // 通配匹配：mcp:serverName:*
    const wildcardMatch = /^mcp:([^:]+):\*$/.exec(name);
    if (wildcardMatch) {
      const serverName = wildcardMatch[1];
      for (const entry of toolPool.values()) {
        if (entry.serverName === serverName) {
          result.push(mcpEntryToToolDef(entry));
        }
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
  if (!client?.connected) throw new Error(`MCP server ${entry.serverName} 未连接`);
  return client.callTool(entry.toolName, args);
}

/** 获取所有 server 状态 */
export function getMcpStatus(): McpServerStatus[] {
  const statuses: McpServerStatus[] = [];
  for (const [name, client] of clients) {
    statuses.push({
      name,
      enabled: true,
      connected: client.connected,
      toolCount: client.tools.length,
    });
  }
  return statuses;
}

/** 关闭所有连接 */
export function shutdownMcpManager(): void {
  for (const client of clients.values()) client.disconnect();
  clients.clear();
  toolPool.clear();
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
