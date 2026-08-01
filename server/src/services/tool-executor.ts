/**
 * 工具执行服务 — 从 vite.config.ts 迁移
 *
 * 核心逻辑：根据工具名查找定义 → 执行（template/builtin/custom）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveExecutionContext, type SandboxLevelInput } from './execution-context.js';
import { skillDir, toolExecutorDir, toolRegistryFile } from './data-paths.js';

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
  // format：仅拦「格式化盘符」如 `format C:`，不误伤 URL 里的 format=json 等
  /mkfs/i, /\bformat\s+[a-z]:/i, /fdisk/i,
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
      toolRegistryFile(dataDir), 'utf-8',
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
        const toolsPath = path.join(skillDir(dataDir, entry.name), 'tools.json');
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

/** 收集 registry + 所有 skills 的已知工具名（用于归一化候选匹配）。 */
async function listKnownToolNames(dataDir: string): Promise<string[]> {
  const names = new Set<string>();
  try {
    const raw = await fs.readFile(toolRegistryFile(dataDir), 'utf-8');
    for (const t of JSON.parse(raw) as ToolDefWithSource[]) if (t?.name) names.add(t.name);
  } catch { /* skip */ }
  try {
    const skillsDir = path.join(dataDir, 'skills');
    const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(path.join(skillDir(dataDir, entry.name), 'tools.json'), 'utf-8');
        for (const t of JSON.parse(raw) as ToolDefWithSource[]) if (t?.name) names.add(t.name);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return [...names];
}

/**
 * 工具名归一化匹配。本地模型（7B~35B）常吐脏工具名：带空格、大小写不一、
 * `functions.`/`tools.` 前缀、`namespace/tool` 分隔。精确匹配不中时按候选顺序
 * 归一化，在 known 里找【唯一】匹配才返回规范名；有歧义（多个匹配）则放弃。
 * 绝不做模糊/编辑距离匹配（避免把 read 错纠成 reads 这类危险纠正）。
 */
export function resolveToolName(raw: string, known: string[]): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || known.length === 0) return null;

  const candidates: string[] = [];
  const add = (v: string) => { const c = v.trim(); if (c && !candidates.includes(c)) candidates.push(c); };
  add(trimmed);
  const dotted = trimmed.replace(/\//g, '.');                 // namespace/tool → namespace.tool
  add(dotted);
  add(dotted.replace(/^(?:functions?|tools?)[._-]/i, ''));    // 剥 functions./tools. 前缀
  const segs = dotted.split('.').map(s => s.trim()).filter(Boolean);
  if (segs.length > 1) add(segs[segs.length - 1]);            // 取最后一段

  for (const cand of candidates) {
    const folded = cand.toLowerCase();
    const hits = known.filter(n => n.toLowerCase() === folded);
    if (hits.length === 1) return hits[0];                    // 唯一匹配才采纳
    if (hits.length > 1) return null;                          // 歧义 → 放弃
  }
  return null;
}

export async function executeTool(
  dataDir: string,
  tool: string,
  args: Record<string, string>,
  agentId: string,
  workspaceDirOverride?: string,
  sandboxLevelOverride?: SandboxLevelInput,
  // UI 侧通道：执行器可返回 { result, meta } 携带展示用元数据（如覆盖写入的旧内容）。
  // meta 仅通过此回调外溢给调用方转发前端，绝不进入 LLM 结果字符串。不传则丢弃 meta。
  onMeta?: (meta: unknown) => void,
  signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<string> {
  if (signal?.aborted) throw createAbortError();
  // MCP 工具：本执行器只认本地工具/技能注册表，mcp: 前缀必须直接走 MCP client。
  // 在此单点拦截，可一并修复所有入口（HTTP /api/tools/exec、各 sub-agent-runner、信风 node-runner）。
  if (tool.startsWith('mcp:')) {
    const { callMcpTool } = await import('../engine/shared/mcp-manager');
    try {
      return await callMcpTool(tool, args);
    } catch (e) {
      return `（MCP 工具调用失败：${tool}）${(e as Error).message}`;
    }
  }
  const resolved = await resolveToolDefinition(dataDir, tool);
  if (!resolved) {
    // 未知工具不是系统故障，而是模型用错了工具名（或复读了协议示例占位符）。
    // 返回友好结果让模型自我纠正，不抛异常（避免被上层包成 HTTP 500 崩掉本轮对话）。
    return `（未知工具：${tool}）该工具不存在。请检查工具名是否正确，或确认是否误把协议示例当成了真实调用。`;
  }
  tool = resolved.tool;
  const toolDef = resolved.toolDef;

  const resolvedContext = await resolveExecutionContext(
    dataDir,
    agentId,
    workspaceDirOverride,
    sandboxLevelOverride,
  );
  const ctx = { ...resolvedContext, signal, onOutput };

  if (toolDef.executorType === 'template' && toolDef.executorTemplate) {
    return executeTemplateTool(dataDir, toolDef, args, ctx, signal);
  }

  if (toolDef.executorType === 'builtin' || toolDef.executorType === 'custom') {
    return executeModuleTool(dataDir, tool, toolDef, args, ctx, onMeta, signal);
  }

  throw new Error(`未知执行器类型: ${toolDef.executorType}`);
}

async function resolveToolDefinition(dataDir: string, tool: string) {
  let toolDef = await findToolInRegistry(dataDir, tool) ?? await findToolInSkills(dataDir, tool);
  if (toolDef) return { tool, toolDef };
  const normalized = resolveToolName(tool, await listKnownToolNames(dataDir));
  if (!normalized || normalized === tool) return null;
  console.warn(`[tool-executor] 工具名归一化：${JSON.stringify(tool)} → ${normalized}`);
  toolDef = await findToolInRegistry(dataDir, normalized) ?? await findToolInSkills(dataDir, normalized);
  return toolDef ? { tool: normalized, toolDef } : null;
}

async function executeTemplateTool(
  dataDir: string, toolDef: ToolDefWithSource, args: Record<string, string>,
  ctx: Awaited<ReturnType<typeof resolveExecutionContext>>, signal?: AbortSignal,
): Promise<string> {
  let cmd = toolDef.executorTemplate!;
  for (const [key, value] of Object.entries(args)) {
    cmd = cmd.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  const blocked = checkBlockedCommand(cmd);
  if (blocked) return `(安全拦截) ${blocked}`;
  const runnerPath = path.join(toolExecutorDir(dataDir), 'run_command.js');
  const runner = await importWithCache(runnerPath);
  if (typeof runner.runCommand !== 'function') {
    throw new Error(`命令执行器未导出 runCommand: ${runnerPath}`);
  }
  return runner.runCommand(cmd, { cwd: ctx.workspaceDir || ctx.projectDir, timeout: 15000, signal });
}

async function executeModuleTool(
  dataDir: string, tool: string, toolDef: ToolDefWithSource,
  args: Record<string, string>, ctx: object,
  onMeta?: (meta: unknown) => void, signal?: AbortSignal,
): Promise<string> {
  const fileName = toolDef.executorFile || tool;
  const candidates = toolDef._skillId
    ? [path.join(skillDir(dataDir, toolDef._skillId), 'executors', `${fileName}.js`)] : [];
  candidates.push(path.join(toolExecutorDir(dataDir), `${fileName}.js`));
  let lastError: unknown;
  for (const filePath of candidates) {
    try {
      const fn = (await importWithCache(filePath)).default;
      if (typeof fn !== 'function') throw new Error(`执行器未导出 default 函数: ${filePath}`);
      const out = await fn(args, ctx);
      if (!out || typeof out !== 'object' || !('result' in out)) return out;
      onMeta?.((out as { meta?: unknown }).meta);
      return String((out as { result: unknown }).result ?? '');
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  const code = (lastError as NodeJS.ErrnoException)?.code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    throw new Error(`执行器文件不存在: ${fileName}.js`);
  }
  throw lastError;
}

function createAbortError(): Error {
  const error = new Error('(工具执行已中止)');
  error.name = 'AbortError';
  return error;
}
