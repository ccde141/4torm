import type { FastifyInstance, FastifyReply } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { normalizeMcpConfig } from '../engine/shared/mcp-config.js';
import { readMcpConfigs, writeMcpConfigs } from '../engine/shared/mcp-config-store.js';
import type { McpServerConfig } from '../engine/shared/mcp-types.js';
import {
  disconnectServer,
  getMcpStatus,
  getMcpToolDefs,
  reconnectServer,
} from '../engine/shared/mcp-manager.js';

function badConfig(reply: FastifyReply, error: unknown): null {
  reply.status(400).send({ error: (error as Error).message });
  return null;
}

function parseConfig(value: unknown, reply: FastifyReply): McpServerConfig | null {
  try { return normalizeMcpConfig(value); }
  catch (error) { return badConfig(reply, error); }
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function reconnectEnabled(dataDir: string, config: McpServerConfig, reply: FastifyReply): Promise<boolean> {
  if (!config.enabled) return true;
  try { await reconnectServer(dataDir, config.name); return true; }
  catch (error) {
    reply.status(502).send({ error: `MCP 连接失败：${(error as Error).message}` });
    return false;
  }
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.get('/list', async (_req, reply) => {
    const configs = await readMcpConfigs(dataDir);
    const statusMap = new Map(getMcpStatus().map(status => [status.name, status]));
    return reply.send(configs.map(config => ({
      ...config,
      connected: statusMap.get(config.name)?.connected ?? false,
      toolCount: statusMap.get(config.name)?.toolCount ?? 0,
    })));
  });

  app.post('/add', async (req, reply) => {
    const config = parseConfig(req.body, reply);
    if (!config) return;
    const configs = await readMcpConfigs(dataDir);
    if (configs.some(item => item.name === config.name)) {
      return reply.status(409).send({ error: `名称已存在：${config.name}` });
    }
    await writeMcpConfigs(dataDir, [...configs, config]);
    if (!await reconnectEnabled(dataDir, config, reply)) return;
    return reply.send({ ok: true, config });
  });

  app.post('/update', async (req, reply) => {
    const body = objectBody(req.body);
    const name = typeof body.name === 'string' ? body.name : '';
    const configs = await readMcpConfigs(dataDir);
    const index = configs.findIndex(item => item.name === name);
    if (index < 0) return reply.status(404).send({ error: `未找到：${name}` });
    const config = parseConfig({ ...configs[index], ...body, name, enabled: configs[index].enabled }, reply);
    if (!config) return;
    configs[index] = config;
    await writeMcpConfigs(dataDir, configs);
    if (!await reconnectEnabled(dataDir, config, reply)) return;
    return reply.send({ ok: true, config });
  });

  app.post('/import', async (req, reply) => {
    const body = objectBody(req.body);
    if (!Array.isArray(body.configs) || body.configs.length === 0) {
      return reply.status(400).send({ error: 'configs 必须是非空数组' });
    }
    let imported: McpServerConfig[];
    try { imported = body.configs.map(normalizeMcpConfig); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
    const configs = await readMcpConfigs(dataDir);
    const names = new Set(configs.map(config => config.name));
    for (const config of imported) {
      if (names.has(config.name)) return reply.status(409).send({ error: `名称已存在：${config.name}` });
      names.add(config.name);
    }
    await writeMcpConfigs(dataDir, [...configs, ...imported]);
    const failures: string[] = [];
    for (const config of imported) {
      if (!config.enabled) continue;
      try { await reconnectServer(dataDir, config.name); }
      catch (error) { failures.push(`${config.name}: ${(error as Error).message}`); }
    }
    if (failures.length) return reply.status(502).send({ error: failures.join('\n'), imported: imported.length });
    return reply.send({ ok: true, imported: imported.length });
  });

  app.post('/remove', async (req, reply) => {
    const { name } = objectBody(req.body);
    if (typeof name !== 'string' || !name) return reply.status(400).send({ error: '缺少 name' });
    const configs = await readMcpConfigs(dataDir);
    const filtered = configs.filter(item => item.name !== name);
    if (filtered.length === configs.length) return reply.status(404).send({ error: '未找到' });
    await writeMcpConfigs(dataDir, filtered);
    disconnectServer(name);
    return reply.send({ ok: true });
  });

  app.post('/toggle', async (req, reply) => {
    const body = objectBody(req.body);
    const name = typeof body.name === 'string' ? body.name : '';
    const enabled = body.enabled;
    if (!name || typeof enabled !== 'boolean') return reply.status(400).send({ error: '缺少 name 或 enabled' });
    const configs = await readMcpConfigs(dataDir);
    const config = configs.find(item => item.name === name);
    if (!config) return reply.status(404).send({ error: '未找到' });
    config.enabled = enabled;
    await writeMcpConfigs(dataDir, configs);
    if (enabled && !await reconnectEnabled(dataDir, config, reply)) return;
    if (!enabled) disconnectServer(name);
    return reply.send({ ok: true, enabled });
  });

  app.post('/reconnect', async (req, reply) => {
    const { name } = objectBody(req.body);
    if (typeof name === 'string' && name) {
      try { await reconnectServer(dataDir, name); }
      catch (error) { return reply.status(502).send({ error: (error as Error).message }); }
      return reply.send({ ok: true });
    }
    const failures: string[] = [];
    for (const config of await readMcpConfigs(dataDir)) {
      if (!config.enabled) continue;
      try { await reconnectServer(dataDir, config.name); }
      catch (error) { failures.push(`${config.name}: ${(error as Error).message}`); }
    }
    if (failures.length) return reply.status(502).send({ error: failures.join('\n') });
    return reply.send({ ok: true });
  });

  app.get('/tools', async (_req, reply) => {
    const groups: Record<string, Array<{ name: string; fullName: string; description: string }>> = {};
    for (const tool of getMcpToolDefs()) {
      const parts = tool.name.split(':');
      const serverName = parts[1] || 'unknown';
      if (!groups[serverName]) groups[serverName] = [];
      groups[serverName].push({
        name: parts.slice(2).join(':'), fullName: tool.name,
        description: tool.description.replace(/^\[MCP:[^\]]*\]\s*/, ''),
      });
    }
    return reply.send({ groups, servers: getMcpStatus() });
  });
}
