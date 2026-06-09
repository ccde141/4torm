/**
 * 工具定义加载器（Node 端）
 *
 * 共享基础设施：信风 & 对流共用。
 * 按 Agent 实体的 tools[] / skills[] 配置，从 4torm 数据目录读取完整 ToolDef[]。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveMcpTools } from './mcp-manager';

/** 与 src/store/tools.ts 的 ToolDef 同构 */
export interface ToolDef {
  name: string;
  description: string;
  category?: string;
  dangerous?: boolean;
  parameters?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  executorType?: string;
  executorFile?: string;
  executorTemplate?: string;
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadRegistryTools(dataDir: string, names: string[]): Promise<ToolDef[]> {
  if (names.length === 0) return [];
  const all = await readJsonSafe<ToolDef[]>(path.join(dataDir, 'tools', 'registry.json'));
  if (!Array.isArray(all)) return [];
  const set = new Set(names);
  return all.filter(t => t && typeof t.name === 'string' && set.has(t.name));
}

async function loadSkillTools(dataDir: string, skillId: string): Promise<ToolDef[]> {
  const file = path.join(dataDir, 'skills', skillId, 'tools.json');
  const tools = await readJsonSafe<ToolDef[]>(file);
  return Array.isArray(tools) ? tools.filter(t => t && typeof t.name === 'string') : [];
}

/**
 * 加载某 Agent 实体可用的全部工具定义。
 *
 * 合并规则：
 * - tools[]（registry.json 命中的工具）
 * - skills[] 携带的工具（去重，registry 优先）
 * - 若 skills.length > 0 且工具集中含 use_skill：动态改写其 description
 */
export async function loadAgentToolDefs(
  dataDir: string,
  toolNames: string[],
  skillIds: string[],
): Promise<ToolDef[]> {
  const result: ToolDef[] = [];
  const seenNames = new Set<string>();

  // 1) 从 registry 加载 toolNames（排除 mcp: 前缀的）
  const localNames = toolNames.filter(n => !n.startsWith('mcp:'));
  const mcpNames = toolNames.filter(n => n.startsWith('mcp:'));

  const registryTools = await loadRegistryTools(dataDir, localNames);
  for (const t of registryTools) {
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
