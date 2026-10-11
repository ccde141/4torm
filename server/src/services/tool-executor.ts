/**
 * 工具执行服务 — 从 vite.config.ts 迁移
 *
 * 核心逻辑：根据工具名查找定义 → 执行（template/builtin/custom）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveExecutionContext, type SandboxLevelInput } from './execution-context.js';
import { skillDir, toolExecutorDir } from './data-paths.js';
import { FRAMEWORK_TOOLS, findFrameworkTool } from '../tools/framework/catalog.js';
import type { ToolDefinition } from '../tools/tool-definition.js';
import type { ToolExecutionMode } from '../tools/tool-definition.js';
import { loadAgent } from '../engine/shared/agent-loader.js';
import { loadAgentToolBindings, type AgentToolBinding } from '../engine/shared/tool-defs-loader.js';
import { FrameworkError } from '../engine/shared/framework-error.js';
import { inspectToolNames } from '../tools/tool-name-policy.js';
import type { McpToolOutcome } from '../engine/shared/mcp-types.js';

export class ToolPermissionError extends FrameworkError {
  constructor(tool: string, agentId: string) {
    super({
      code: 'TOOL_PERMISSION_DENIED', kind: 'permission',
      message: `Agent ${agentId} 未获准使用工具：${tool}`,
      source: 'tool.executor', retryable: false,
    });
    this.name = 'ToolPermissionError';
  }
}

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

interface ToolDefWithSource extends ToolDefinition {
  _skillId?: string;
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
  return (await executeToolOutcome(
    dataDir, tool, args, agentId, workspaceDirOverride, sandboxLevelOverride,
    onMeta, signal, onOutput,
  )).result;
}

/** Status-aware execution; the string API above keeps its original return shape. */
export async function executeToolOutcome(
  ...params: Parameters<typeof executeTool>
): Promise<McpToolOutcome> {
  const [dataDir, tool, args, agentId, workspaceDirOverride, sandboxLevelOverride,
    onMeta, signal, onOutput] = params;
  if (signal?.aborted) throw createAbortError();
  if (tool.startsWith('mcp:')) return executeMcpToolOutcome(dataDir, tool, args, agentId);
  const resolved = await resolveToolDefinition(dataDir, tool);
  if (!resolved) {
    // 未知工具不是系统故障，而是模型用错了工具名（或复读了协议示例占位符）。
    // 返回友好结果让模型自我纠正，不抛异常（避免被上层包成 HTTP 500 崩掉本轮对话）。
    return { result: `（未知工具：${tool}）该工具不存在。请检查工具名是否正确，或确认是否误把协议示例当成了真实调用。`, ok: false };
  }
  const canonicalTool = resolved.tool;
  const authorization = await assertAgentToolAccess(dataDir, agentId, canonicalTool, args);
  const toolDef: ToolDefWithSource = authorization
    ? { ...authorization.definition, ...(authorization.skillId ? { _skillId: authorization.skillId } : {}) }
    : resolved.toolDef;

  const resolvedContext = await resolveExecutionContext(
    dataDir,
    agentId,
    workspaceDirOverride,
    sandboxLevelOverride,
  );
  const ctx = { ...resolvedContext, signal, onOutput };

  if (toolDef.executorType === 'template' && toolDef.executorTemplate) {
    return { result: await executeTemplateTool(dataDir, toolDef, args, ctx, signal, onOutput), ok: true };
  }

  if (toolDef.executorType === 'builtin' || toolDef.executorType === 'custom') {
    return { result: await executeModuleTool(
      dataDir, canonicalTool, toolDef, args, ctx, onMeta, signal,
    ), ok: true };
  }

  throw new Error(`未知执行器类型: ${toolDef.executorType}`);
}

async function executeMcpToolOutcome(
  dataDir: string, tool: string, args: Record<string, string>, agentId: string,
): Promise<McpToolOutcome> {
  await assertAgentToolAccess(dataDir, agentId, tool);
  const { callMcpToolOutcome } = await import('../engine/shared/mcp-manager');
  try { return await callMcpToolOutcome(tool, args); }
  catch (error) {
    return { result: `（MCP 工具调用失败：${tool}）${(error as Error).message}`, ok: false };
  }
}

/** 运行入口只根据工具定义决定是否允许后台化；缺省和未知工具一律同步。 */
export async function getToolExecutionMode(dataDir: string, tool: string): Promise<ToolExecutionMode> {
  if (tool.startsWith('mcp:')) return 'sync';
  const resolved = await resolveToolDefinition(dataDir, tool);
  return resolved?.toolDef.executionMode === 'detachable' ? 'detachable' : 'sync';
}

async function assertAgentToolAccess(
  dataDir: string, agentId: string, tool: string, args?: Record<string, string>,
): Promise<AgentToolBinding | undefined> {
  if (!agentId) {
    if (tool === 'use_skill') throw new ToolPermissionError(tool, '未指定');
    return undefined;
  }
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) throw new ToolPermissionError(tool, agentId);
  if (tool === 'use_skill') {
    if (!args?.skill) throw new Error('缺少 skill 参数');
    if (!agent.skills.includes(args.skill)) {
      throw new ToolPermissionError(`${tool}:${args.skill}`, agentId);
    }
  }
  const allowed = await loadAgentToolBindings(dataDir, agent.tools, agent.skills, agent.toolMode);
  const binding = allowed.find(item => item.definition.name === tool);
  if (!binding || (tool.startsWith('mcp:') && binding.source !== 'mcp')) {
    throw new ToolPermissionError(tool, agentId);
  }
  return binding;
}

async function resolveToolDefinition(dataDir: string, tool: string) {
  const snapshot = await inspectToolNames(dataDir);
  const known = [...FRAMEWORK_TOOLS.map(item => item.name),
    ...snapshot.custom.map(item => item.name),
    ...[...snapshot.skills.values()].flatMap(items => items.map(item => item.name))];
  const normalized = known.includes(tool) ? tool : resolveToolName(tool, [...new Set(known)]);
  if (!normalized) return null;
  const builtin = findFrameworkTool(normalized);
  if (builtin) return { tool: normalized, toolDef: builtin };
  const conflict = snapshot.issues.find(issue => issue.name === normalized);
  if (conflict) throw new Error(`工具名称冲突：${normalized}；${conflict.reason}`);
  if (normalized !== tool) console.warn(`[tool-executor] 工具名归一化：${JSON.stringify(tool)} → ${normalized}`);
  const custom = snapshot.custom.find(item => item.name === normalized);
  if (custom) {
    const { _skillId: _owner, ...definition } = custom as ToolDefWithSource;
    return { tool: normalized, toolDef: definition };
  }
  for (const [skillId, items] of snapshot.skills) {
    const skillTool = items.find(item => item.name === normalized);
    if (skillTool) return { tool: normalized, toolDef: { ...skillTool, _skillId: skillId } };
  }
  return null;
}

async function executeTemplateTool(
  dataDir: string, toolDef: ToolDefWithSource, args: Record<string, string>,
  ctx: Awaited<ReturnType<typeof resolveExecutionContext>>, signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
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
  return runner.runCommand(cmd, { cwd: ctx.workspaceDir || ctx.projectDir, timeout: 15000, signal, onOutput });
}

async function executeModuleTool(
  dataDir: string, tool: string, toolDef: ToolDefWithSource,
  args: Record<string, string>, ctx: object,
  onMeta?: (meta: unknown) => void, signal?: AbortSignal,
): Promise<string> {
  const fileName = toolDef.executorFile || tool;
  const candidates = toolDef._skillId
    ? [path.join(skillDir(dataDir, toolDef._skillId), 'executors', `${fileName}.js`)]
    : [path.join(toolExecutorDir(dataDir), `${fileName}.js`)];
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
