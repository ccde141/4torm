import fs from 'node:fs/promises';
import { mkdirSync, watch } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomic-io.js';
import { normalizeMcpConfig } from './mcp-config.js';
import type { McpServerConfig } from './mcp-types.js';
import { mcpServersFile } from '../../services/data-paths.js';

export async function readMcpConfigs(dataDir: string): Promise<McpServerConfig[]> {
  let raw: string;
  try { raw = await fs.readFile(mcpServersFile(dataDir), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('MCP 配置文件必须是数组');
  return value.map(normalizeMcpConfig);
}

export async function writeMcpConfigs(dataDir: string, configs: McpServerConfig[]): Promise<void> {
  const file = mcpServersFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, JSON.stringify(configs, null, 2));
}

export function watchMcpConfigs(dataDir: string, onChange: () => void): () => void {
  const dir = path.dirname(mcpServersFile(dataDir));
  mkdirSync(dir, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dir, (_event, filename) => {
    if (filename && filename !== 'servers.json') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 300);
  });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
