/**
 * MCP 管理路由
 *
 * 端点：
 *   GET  /api/mcp/list      — 列出所有 MCP server 配置 + 连接状态
 *   POST /api/mcp/add       — 添加新 MCP server
 *   POST /api/mcp/update    — 编辑现有 server 的 command/args/env
 *   POST /api/mcp/remove    — 移除 MCP server
 *   POST /api/mcp/toggle    — 启用/禁用
 *   POST /api/mcp/reconnect — 重新连接指定 server
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io';
import type { McpServerConfig } from '../engine/shared/mcp-client';
import { getMcpStatus, getMcpToolDefs, reconnectServer, disconnectServer } from '../engine/shared/mcp-manager';

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;
  const configPath = path.join(dataDir, 'mcp', 'servers.json');

  async function readConfigs(): Promise<McpServerConfig[]> {
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async function writeConfigs(configs: McpServerConfig[]): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await atomicWriteFile(configPath, JSON.stringify(configs, null, 2));
  }

  // GET /api/mcp/list
  app.get('/list', async (_req, reply) => {
    const configs = await readConfigs();
    const statuses = getMcpStatus();
    const statusMap = new Map(statuses.map(s => [s.name, s]));
    const list = configs.map(cfg => ({
      ...cfg,
      connected: statusMap.get(cfg.name)?.connected ?? false,
      toolCount: statusMap.get(cfg.name)?.toolCount ?? 0,
    }));
    return reply.send(list);
  });

  // POST /api/mcp/add
  app.post('/add', async (req, reply) => {
    const body = req.body as Partial<McpServerConfig>;
    if (!body.name || !body.command) {
      return reply.status(400).send({ error: '缺少 name 或 command' });
    }
    const configs = await readConfigs();
    if (configs.some(c => c.name === body.name)) {
      return reply.status(409).send({ error: `名称已存在：${body.name}` });
    }
    const newCfg: McpServerConfig = {
      name: body.name,
      enabled: body.enabled ?? true,
      transport: 'stdio',
      command: body.command,
      args: body.args || [],
      env: body.env || {},
      ...(body.autoWorkspaces ? { autoWorkspaces: true } : {}),
    };
    configs.push(newCfg);
    await writeConfigs(configs);
    // 如果 enabled 则只连接这一个（不影响其他 server）
    if (newCfg.enabled) {
      await reconnectServer(dataDir, newCfg.name);
    }
    return reply.send({ ok: true, config: newCfg });
  });

  // POST /api/mcp/update — 编辑现有 server 的 command/args/env（name 为定位键，不可改）
  app.post('/update', async (req, reply) => {
    const body = req.body as Partial<McpServerConfig> & { name: string };
    if (!body.name || !body.command) {
      return reply.status(400).send({ error: '缺少 name 或 command' });
    }
    const configs = await readConfigs();
    const target = configs.find(c => c.name === body.name);
    if (!target) return reply.status(404).send({ error: `未找到：${body.name}` });
    target.command = body.command;
    target.args = body.args || [];
    target.env = body.env || {};
    if (body.autoWorkspaces) target.autoWorkspaces = true;
    else delete target.autoWorkspaces;
    await writeConfigs(configs);
    // 改了启动参数 → 若启用则重连使新配置生效
    if (target.enabled) await reconnectServer(dataDir, target.name);
    return reply.send({ ok: true, config: target });
  });

  // POST /api/mcp/remove
  app.post('/remove', async (req, reply) => {
    const { name } = req.body as { name: string };
    if (!name) return reply.status(400).send({ error: '缺少 name' });
    const configs = await readConfigs();
    const filtered = configs.filter(c => c.name !== name);
    if (filtered.length === configs.length) {
      return reply.status(404).send({ error: '未找到' });
    }
    await writeConfigs(filtered);
    disconnectServer(name); // 只断这一个
    return reply.send({ ok: true });
  });

  // POST /api/mcp/toggle
  app.post('/toggle', async (req, reply) => {
    const { name, enabled } = req.body as { name: string; enabled: boolean };
    if (!name || typeof enabled !== 'boolean') {
      return reply.status(400).send({ error: '缺少 name 或 enabled' });
    }
    const configs = await readConfigs();
    const target = configs.find(c => c.name === name);
    if (!target) return reply.status(404).send({ error: '未找到' });
    target.enabled = enabled;
    await writeConfigs(configs);
    // 只动这一个：启用→连接，停用→断开
    if (enabled) await reconnectServer(dataDir, name);
    else disconnectServer(name);
    return reply.send({ ok: true, enabled });
  });

  // POST /api/mcp/reconnect — 传 name 只重连该 server；不传则逐个重连所有 enabled（非全量核爆）
  app.post('/reconnect', async (req, reply) => {
    const { name } = (req.body || {}) as { name?: string };
    if (name) {
      await reconnectServer(dataDir, name);
    } else {
      const configs = await readConfigs();
      for (const cfg of configs) {
        if (cfg.enabled && cfg.transport === 'stdio') await reconnectServer(dataDir, cfg.name);
      }
    }
    return reply.send({ ok: true });
  });

  // GET /api/mcp/tools — 返回所有 MCP 工具（按 server 分组）
  app.get('/tools', async (_req, reply) => {
    const statuses = getMcpStatus();
    const allTools = getMcpToolDefs();
    // 按 server 分组
    const groups: Record<string, Array<{ name: string; fullName: string; description: string }>> = {};
    for (const tool of allTools) {
      // fullName: mcp:serverName:toolName
      const parts = tool.name.split(':');
      const serverName = parts[1] || 'unknown';
      const toolName = parts.slice(2).join(':');
      if (!groups[serverName]) groups[serverName] = [];
      groups[serverName].push({
        name: toolName,
        fullName: tool.name,
        description: tool.description.replace(/^\[MCP:[^\]]*\]\s*/, ''),
      });
    }
    return reply.send({ groups, servers: statuses });
  });
}
