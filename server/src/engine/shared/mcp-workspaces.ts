import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpStdioConfig } from './mcp-types.js';

const WORKSPACE_ROOTS = [
  { base: 'agents', sub: '.workspace' },
  { base: 'cyclone', sub: 'workspace' },
  { base: 'convection/sessions', sub: 'workspace' },
  { base: 'tradewind/workflows', sub: 'workspace' },
] as const;

async function scanWorkspaceDirs(dataDir: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const { base, sub } of WORKSPACE_ROOTS) {
    const parent = path.join(dataDir, base);
    const entries = await fs.readdir(parent).catch(() => [] as string[]);
    for (const name of entries) {
      const workspace = path.join(parent, name, sub);
      const stat = await fs.stat(workspace).catch(() => null);
      if (stat?.isDirectory()) dirs.push(workspace);
    }
  }
  return dirs;
}

export async function withAutomaticWorkspaces(config: McpStdioConfig, dataDir: string): Promise<McpStdioConfig> {
  if (!config.autoWorkspaces) return config;
  const workspaces = await scanWorkspaceDirs(dataDir);
  const additions = workspaces.filter(workspace => !config.args.includes(workspace));
  return { ...config, args: [...config.args, ...additions] };
}
