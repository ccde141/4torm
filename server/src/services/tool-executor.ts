/**
 * 工具执行服务 — 从 vite.config.ts 迁移
 *
 * 核心逻辑：根据工具名查找定义 → 执行（template/builtin/custom）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 热重载缓存：文件路径 → { mtime, module }
const modCache = new Map<string, { mtime: number; mod: any }>();

async function importWithCache(filePath: string) {
  const stat = await fs.stat(filePath);
  const mtime = stat.mtimeMs;
  const cached = modCache.get(filePath);
  if (cached && cached.mtime === mtime) return cached.mod;
  // mtime 变了或首次加载，用唯一 URL 强制重新 import
  const fileUrl = pathToFileURL(filePath).href;
  const mod = await import(`${fileUrl}?v=${mtime}`);
  modCache.set(filePath, { mtime, mod });
  return mod;
}

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf/i, /rmdir\s+\/s/i, /del\s+\/f/i,
  /shutdown/i, /reboot/i, /halt/i, /poweroff/i,
  /mkfs/i, /format/i, /fdisk/i,
  /dd\s+if=/i,
];
function checkBlockedCommand(cmd: string): string | null {
  // 开发环境足量权限：不限命令长度，仅拦截高危破坏性操作
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(cmd)) {
      return `命令包含被禁止的操作: ${pattern}`;
    }
  }
  return null;
}

interface ToolDefWithSource {
  name: string;
  description: string;
  executorType: string;
  executorFile?: string;
  executorTemplate?: string;
  _skillId?: string;
}

export async function findToolInRegistry(
  dataDir: string, tool: string,
): Promise<ToolDefWithSource | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(dataDir, 'tools/registry.json'), 'utf-8',
    );
    const registry: ToolDefWithSource[] = JSON.parse(raw);
    return registry.find(t => t.name === tool);
  } catch { return undefined; }
}

export async function findToolInSkills(
  dataDir: string, tool: string,
): Promise<ToolDefWithSource | undefined> {
  try {
    const skillsDir = path.join(dataDir, 'skills');
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
      .catch(() => [] as Array<{ name: string; isDirectory(): boolean }>);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const toolsPath = path.join(skillsDir, entry.name, 'tools.json');
        const toolsRaw = await fs.readFile(toolsPath, 'utf-8');
        const tools: ToolDefWithSource[] = JSON.parse(toolsRaw);
        const found = tools.find(t => t.name === tool);
        if (found) {
          found._skillId = entry.name;
          return found;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return undefined;
}

async function getAgentConfig(dataDir: string, agentId: string): Promise<{ workspace: string; sandboxLevel: 'strict' | 'relaxed' | 'unrestricted' }> {
  const projectDir = path.resolve(dataDir, '..');
  let workspace = path.resolve(dataDir, 'agents', agentId, '.workspace');
  let sandboxLevel: 'strict' | 'relaxed' | 'unrestricted' = 'relaxed';
  try {
    const raw = await fs.readFile(path.join(dataDir, 'agents/registry.json'), 'utf-8');
    const registry = JSON.parse(raw);
    const agent = registry[agentId];
    if (agent?.config?.workspace) {
      workspace = path.resolve(projectDir, agent.config.workspace);
    }
    if (agent?.config?.sandboxLevel === 'strict' || agent?.config?.sandboxLevel === 'unrestricted') {
      sandboxLevel = agent.config.sandboxLevel;
    }
  } catch { /* use defaults */ }
  return { workspace, sandboxLevel };
}

export async function executeTool(
  dataDir: string,
  tool: string,
  args: Record<string, string>,
  agentId: string,
  workspaceDirOverride?: string,
  sandboxLevelOverride?: 'strict' | 'relaxed' | 'unrestricted',
): Promise<string> {
  let toolDef = await findToolInRegistry(dataDir, tool);
  if (!toolDef) toolDef = await findToolInSkills(dataDir, tool);
  if (!toolDef) throw new Error(`未知工具: ${tool}`);

  let workspaceDir: string;
  let sandboxLevel: 'strict' | 'relaxed' | 'unrestricted' = 'relaxed';
  if (workspaceDirOverride) {
    workspaceDir = path.resolve(dataDir, '..', workspaceDirOverride);
    // workspace 由调用方覆盖（如信风工作流共享 workspace）
    if (sandboxLevelOverride) {
      sandboxLevel = sandboxLevelOverride;
    } else if (agentId) {
      const cfg = await getAgentConfig(dataDir, agentId);
      sandboxLevel = cfg.sandboxLevel;
    }
  } else if (agentId) {
    const cfg = await getAgentConfig(dataDir, agentId);
    workspaceDir = cfg.workspace;
    sandboxLevel = sandboxLevelOverride ?? cfg.sandboxLevel;
  } else {
    workspaceDir = path.resolve(dataDir, '..');
    if (sandboxLevelOverride) sandboxLevel = sandboxLevelOverride;
  }
  const projectDir = path.resolve(dataDir, '..');
  const ctx = { dataDir, workspaceDir, projectDir, sandboxLevel };

  // template 类型：shell 命令模板
  if (toolDef.executorType === 'template' && toolDef.executorTemplate) {
    let cmd = toolDef.executorTemplate;
    for (const [k, v] of Object.entries(args)) {
      cmd = cmd.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    const blocked = checkBlockedCommand(cmd);
    if (blocked) return `(安全拦截) ${blocked}`;
    // cwd 起点按沙箱级别选择
    const cmdCwd = sandboxLevel === 'strict' ? ctx.workspaceDir : ctx.projectDir;
    try {
      return execSync(cmd, {
        encoding: 'utf-8', timeout: 15000,
        cwd: cmdCwd, maxBuffer: 1024 * 1024,
      }) || '(执行完毕)';
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message: string; signal?: string; killed?: boolean };
      if (err.signal === 'SIGTERM' || err.killed) {
        return '(命令执行超时，已自动终止)';
      }
      return err.stdout || err.stderr || err.message;
    }
  }

  // builtin/custom 类型：JS 模块动态 import
  if (toolDef.executorType === 'builtin' || toolDef.executorType === 'custom') {
    const fileName = toolDef.executorFile || tool;
    const source = toolDef._skillId;

    const candidates = source
      ? [path.join(dataDir, 'skills', source, 'executors', `${fileName}.js`)]
      : [];
    candidates.push(path.join(dataDir, 'tools/executors', `${fileName}.js`));

    let lastError: unknown;
    for (const filePath of candidates) {
      try {
        const mod = await importWithCache(filePath);
        const fn = mod.default;
        if (typeof fn !== 'function') {
          throw new Error(`执行器未导出 default 函数: ${filePath}`);
        }
        return await fn(args, ctx);
      } catch (e) {
        lastError = e;
      }
    }
    const errCode = (lastError as NodeJS.ErrnoException)?.code;
    if (errCode === 'MODULE_NOT_FOUND' || errCode === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`执行器文件不存在: ${fileName}.js`);
    }
    throw lastError;
  }

  throw new Error(`未知执行器类型: ${toolDef.executorType}`);
}
