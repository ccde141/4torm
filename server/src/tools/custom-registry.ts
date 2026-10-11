import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io.js';
import { toolRegistryFile } from '../services/data-paths.js';
import { FRAMEWORK_TOOLS } from './framework/catalog.js';
import type { ToolCatalogEntry, ToolDefinition } from './tool-definition.js';
import { inspectToolNames, toolNameProblem, toolSourceIssue, type ToolNameIssue } from './tool-name-policy.js';

function stripFrameworkCapability(tool: ToolDefinition): ToolDefinition {
  const safe = { ...tool };
  delete safe.frameworkCapability;
  delete (safe as ToolDefinition & { _skillId?: string })._skillId;
  return safe;
}

function validateCustomTool(value: unknown, reserved: ReadonlySet<string>): ToolDefinition {
  if (!value || typeof value !== 'object') throw new Error('工具定义必须是对象');
  const tool = value as ToolDefinition;
  const problem = toolNameProblem(tool.name ?? '', [...reserved]);
  if (problem) throw new Error(problem.includes('框架保留') ? `框架工具不可覆盖：${tool.name}` : problem);
  if (typeof tool.description !== 'string' || !tool.description.trim()) throw new Error(`工具缺少描述：${tool.name}`);
  if (!tool.parameters || typeof tool.parameters !== 'object') throw new Error(`工具参数必须是 object schema：${tool.name}`);
  if (tool.executorType !== 'custom' && tool.executorType !== 'template') {
    throw new Error(`自定义工具只允许 custom 或 template 执行器：${tool.name}`);
  }
  if (tool.executionMode !== undefined && tool.executionMode !== 'sync' && tool.executionMode !== 'detachable') {
    throw new Error(`工具执行模式无效：${tool.name}`);
  }
  return {
    ...stripFrameworkCapability(tool),
    name: tool.name.trim(),
    description: tool.description.trim(),
    category: 'custom',
    executionMode: tool.executionMode ?? 'sync',
    parameters: { ...tool.parameters, type: 'object' },
  };
}

export async function readCustomTools(dataDir: string): Promise<ToolDefinition[]> {
  const snapshot = await inspectToolNames(dataDir);
  return snapshot.custom.filter(tool => !toolSourceIssue(snapshot, 'custom', tool.name))
    .map(item => {
      const tool = stripFrameworkCapability(item);
      return { ...tool, executionMode: tool.executionMode === 'detachable' ? 'detachable' : 'sync' };
    });
}

export async function replaceCustomTools(
  dataDir: string,
  input: unknown,
  reservedNames: readonly string[] = [],
): Promise<ToolDefinition[]> {
  if (!Array.isArray(input)) throw new Error('tools 必须是数组');
  const reserved = new Set(reservedNames);
  const tools = input.map(item => validateCustomTool(item, reserved));
  const snapshot = await inspectToolNames(dataDir, reservedNames);
  const damagedRegistry = snapshot.issues.find(issue => issue.source === 'custom' && !issue.name
    && /JSON 损坏|不可读|必须是数组/.test(issue.reason));
  if (damagedRegistry) throw new Error(`工具注册表不可安全替换：${damagedRegistry.reason}`);
  const unreadableSkill = snapshot.issues.find(issue => issue.source === 'skill' && !issue.name);
  if (unreadableSkill) throw new Error(`技能工具目录不可校验：${unreadableSkill.reason}`);
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`工具名称重复：${tool.name}`);
    for (const [skillId, skillTools] of snapshot.skills) {
      if (skillTools.some(skillTool => skillTool.name === tool.name)) {
        throw new Error(`工具名称已由技能「${skillId}」提供：${tool.name}`);
      }
    }
    names.add(tool.name);
  }
  await fs.mkdir(path.dirname(toolRegistryFile(dataDir)), { recursive: true });
  await atomicWriteFile(toolRegistryFile(dataDir), JSON.stringify(tools, null, 2));
  return tools;
}

export async function listToolCatalog(
  dataDir: string,
  extensions: ToolDefinition[] = [],
): Promise<ToolCatalogEntry[]> {
  return (await listToolCatalogWithDiagnostics(dataDir, extensions)).tools;
}

export async function listToolCatalogWithDiagnostics(
  dataDir: string,
  extensions: ToolDefinition[] = [],
): Promise<{ tools: ToolCatalogEntry[]; conflicts: ToolNameIssue[] }> {
  const frameworkNames = new Set(FRAMEWORK_TOOLS.map(tool => tool.name));
  for (const tool of extensions) {
    if (frameworkNames.has(tool.name)) throw new Error(`框架工具重复：${tool.name}`);
    frameworkNames.add(tool.name);
  }
  const snapshot = await inspectToolNames(dataDir, extensions.map(tool => tool.name));
  const custom = snapshot.custom.filter(tool => !toolSourceIssue(snapshot, 'custom', tool.name))
    .map(stripFrameworkCapability);
  return { tools: [
    ...FRAMEWORK_TOOLS.map(tool => ({ ...tool, source: 'framework' as const, readonly: true })),
    ...extensions.map(tool => ({
      category: 'system', dangerous: false, executorType: 'builtin', executionMode: 'sync' as const,
      ...tool, source: 'framework' as const, readonly: true,
    })),
    ...custom.map(tool => ({ ...tool, source: 'custom' as const, readonly: false })),
  ], conflicts: snapshot.issues };
}
