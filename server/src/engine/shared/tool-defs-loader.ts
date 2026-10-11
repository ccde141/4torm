/**
 * 工具定义加载器（Node 端）
 *
 * 共享基础设施：信风 & 对流共用。
 * 按 Agent 实体的 tools[] / skills[] 配置，从 4torm 数据目录读取完整 ToolDef[]。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { skillDir } from '../../services/data-paths.js';
import { resolveMcpTools } from './mcp-manager';
import { FRAMEWORK_TOOLS } from '../../tools/framework/catalog.js';
import { inspectToolNames, toolSourceIssue, type ToolNameSnapshot } from '../../tools/tool-name-policy.js';
import type { ToolDefinition } from '../../tools/tool-definition.js';

export type ToolDef = ToolDefinition;
export interface AgentToolBinding {
  definition: ToolDef;
  source: 'framework' | 'custom' | 'skill' | 'mcp';
  skillId?: string;
}

function stripInternalCapability(tool: ToolDef): ToolDef {
  const { frameworkCapability: _internalCapability, _skillId: _owner, ...publicTool } =
    tool as ToolDef & { _skillId?: string };
  return publicTool;
}

function addBinding(
  result: AgentToolBinding[], seen: Set<string>, definition: ToolDef,
  source: AgentToolBinding['source'], skillId?: string,
): void {
  if (seen.has(definition.name)) return;
  result.push({ definition: { ...definition }, source, ...(skillId ? { skillId } : {}) });
  seen.add(definition.name);
}

function addLocalBindings(
  result: AgentToolBinding[], seen: Set<string>, snapshot: ToolNameSnapshot,
  selectedNames: ReadonlySet<string>, toolMode: 'all' | 'selected', hasSkills: boolean,
): void {
  const framework = (toolMode === 'all' ? FRAMEWORK_TOOLS
    : FRAMEWORK_TOOLS.filter(tool => selectedNames.has(tool.name)))
    .filter(tool => tool.name !== 'use_skill' || hasSkills);
  framework.forEach(tool => addBinding(result, seen, tool, 'framework'));
  if (toolMode === 'all') return;
  for (const tool of snapshot.custom) {
    if (selectedNames.has(tool.name) && !toolSourceIssue(snapshot, 'custom', tool.name)) {
      addBinding(result, seen, tool, 'custom');
    }
  }
}

function concise(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

async function skillHint(dataDir: string, skillId: string): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(skillDir(dataDir, skillId), 'config.json'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return skillId;
    return `${skillId} · 元数据不可读`;
  }
  let meta: unknown;
  try { meta = JSON.parse(raw); }
  catch { return `${skillId} · 元数据损坏`; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return `${skillId} · 元数据无效`;
  }
  const fields = meta as Record<string, unknown>;
  const name = concise(fields.name, 36);
  const description = concise(fields.description, 90);
  return [skillId, name, description].filter(Boolean).join(' · ');
}

async function useSkillDescription(dataDir: string, skillIds: string[]): Promise<string> {
  const ids = [...new Set(skillIds)];
  const limit = 1200;
  // 所有 ID 必须可见；超出预算时只省略详细用途，不能隐藏可用技能。
  let description = `任务符合技能用途时，先调用 use_skill 加载指令。skill 参数填技能 ID。已启用技能 ID：${ids.join('、')}\n用途摘要：`;
  let shown = 0;
  for (const id of ids) {
    const line = `\n- ${await skillHint(dataDir, id)}`;
    if (description.length + line.length > limit - 40) break;
    description += line;
    shown++;
  }
  if (shown < ids.length) description += `\n其余 ${ids.length - shown} 项用途摘要省略；ID 如上。`;
  return description;
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
export async function loadAgentToolBindings(
  dataDir: string,
  toolNames: string[] = [],
  skillIds: string[] = [],
  toolMode: 'all' | 'selected' = toolNames.length === 0 ? 'all' : 'selected',
): Promise<AgentToolBinding[]> {
  const result: AgentToolBinding[] = [];
  const seenNames = new Set<string>();
  const snapshot = await inspectToolNames(dataDir);

  const localNames = toolNames.filter(n => !n.startsWith('mcp:'));
  if (skillIds.length > 0 && !localNames.includes('use_skill')) localNames.push('use_skill');
  const mcpNames = toolNames.filter(n => n.startsWith('mcp:'));
  addLocalBindings(result, seenNames, snapshot, new Set(localNames), toolMode, skillIds.length > 0);

  // 2) 仅追加已启用且全局名称无冲突的技能工具。
  for (const skillId of skillIds) {
    for (const tool of snapshot.skills.get(skillId) ?? []) {
      if (!toolSourceIssue(snapshot, 'skill', tool.name, skillId)) {
        addBinding(result, seenNames, tool, 'skill', skillId);
      }
    }
  }

  // 3) MCP 工具（按名称或通配解析）
  const mcpTools = resolveMcpTools(mcpNames);
  mcpTools.forEach(tool => addBinding(result, seenNames, tool, 'mcp'));

  // 4) use_skill 描述动态注入
  if (skillIds.length > 0) {
    const useSkill = result.find(t => t.definition.name === 'use_skill');
    if (useSkill) {
      useSkill.definition.description = await useSkillDescription(dataDir, skillIds);
    }
  }

  return result.map(binding => ({ ...binding, definition: stripInternalCapability(binding.definition) }));
}

export async function loadAgentToolDefs(
  dataDir: string,
  toolNames: string[] = [],
  skillIds: string[] = [],
  toolMode: 'all' | 'selected' = toolNames.length === 0 ? 'all' : 'selected',
): Promise<ToolDef[]> {
  return (await loadAgentToolBindings(dataDir, toolNames, skillIds, toolMode))
    .map(binding => binding.definition);
}
