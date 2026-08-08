/**
 * 工具定义加载器（Node 端）
 *
 * 共享基础设施：信风 & 对流共用。
 * 按 Agent 实体的 tools[] / skills[] 配置，从 4torm 数据目录读取完整 ToolDef[]。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { skillDir, toolRegistryFile } from '../../services/data-paths.js';
import { resolveMcpTools } from './mcp-manager';
import { FRAMEWORK_TOOLS, isFrameworkToolName } from '../../tools/framework/catalog.js';
import type { ToolDefinition } from '../../tools/tool-definition.js';

export type ToolDef = ToolDefinition;

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadCustomTools(dataDir: string, names?: string[]): Promise<ToolDef[]> {
  const all = await readJsonSafe<ToolDef[]>(toolRegistryFile(dataDir));
  if (!Array.isArray(all)) return [];
  const valid = all.filter(t => t && typeof t.name === 'string' && !isFrameworkToolName(t.name));
  if (names === undefined) return valid;
  if (names.length === 0) return [];
  const set = new Set(names);
  return valid.filter(t => set.has(t.name));
}

async function loadSkillTools(dataDir: string, skillId: string): Promise<ToolDef[]> {
  const file = path.join(skillDir(dataDir, skillId), 'tools.json');
  const tools = await readJsonSafe<ToolDef[]>(file);
  return Array.isArray(tools) ? tools.filter(t => t && typeof t.name === 'string') : [];
}

/**
 * 加载某 Agent 实体可用的全部工具定义。
 *
 * 合并规则：
 * - toolMode=all 时加载代码内固定的框架工具
 * - toolMode=selected 时只加载 tools[] 命中的工具，空数组表示不启用本地工具
 * - data/tools/registry.json 只保存用户自定义工具
 * - skills[] 携带的工具（去重，框架/自定义工具优先）
 * - skills[] 非空时自动补充 use_skill，并动态写入可用技能说明
 */
export async function loadAgentToolDefs(
  dataDir: string,
  toolNames: string[] = [],
  skillIds: string[] = [],
  toolMode: 'all' | 'selected' = toolNames.length === 0 ? 'all' : 'selected',
): Promise<ToolDef[]> {
  const result: ToolDef[] = [];
  const seenNames = new Set<string>();

  // 1) 框架工具来自代码内固定清单；用户工具来自 data 注册表。
  const localNames = toolNames.filter(n => !n.startsWith('mcp:'));
  if (skillIds.length > 0 && !localNames.includes('use_skill')) localNames.push('use_skill');
  const mcpNames = toolNames.filter(n => n.startsWith('mcp:'));

  const selectedNames = new Set(localNames);
  const frameworkTools = toolMode === 'all'
    ? FRAMEWORK_TOOLS
    : FRAMEWORK_TOOLS.filter(tool => selectedNames.has(tool.name));
  for (const t of frameworkTools) {
    if (!seenNames.has(t.name)) {
      // 运行时会按 Agent 技能改写 use_skill 描述；不能修改只读框架清单本体。
      result.push({ ...t });
      seenNames.add(t.name);
    }
  }

  const customTools = await loadCustomTools(dataDir, toolMode === 'all' ? [] : localNames);
  for (const t of customTools) {
    if (!seenNames.has(t.name)) {
      result.push(t);
      seenNames.add(t.name);
    }
  }

  // 2) 从 skills 各自的 tools.json 追加（去重，registry 优先级高）
  for (const skillId of skillIds) {
    const skillTools = await loadSkillTools(dataDir, skillId);
    for (const t of skillTools) {
      if (!seenNames.has(t.name)) {
        result.push(t);
        seenNames.add(t.name);
      }
    }
  }

  // 3) MCP 工具（按名称或通配解析）
  const mcpTools = resolveMcpTools(mcpNames);
  for (const t of mcpTools) {
    if (!seenNames.has(t.name)) {
      result.push(t);
      seenNames.add(t.name);
    }
  }

  // 4) use_skill 描述动态注入
  if (skillIds.length > 0) {
    const useSkill = result.find(t => t.name === 'use_skill');
    if (useSkill) {
      useSkill.description = `加载技能指令。当前可用技能: ${skillIds.join(', ')}`;
    }
  }

  return result;
}
