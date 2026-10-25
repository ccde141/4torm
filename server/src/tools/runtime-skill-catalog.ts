import browserTool from './browser/tool.json';
import type { ToolDefinition } from './tool-definition.js';

export const BROWSER_TOOL: ToolDefinition = browserTool;

// Runtime routing and schemas are code-owned. Skill declarations only select
// these bindings; they cannot replace their schema or supply an executor.
const bindings = [{ skillId: 'browser', definition: BROWSER_TOOL }];

export function isRuntimeSkillToolName(name: string): boolean {
  return bindings.some(binding => binding.definition.name === name);
}

export function findRuntimeSkillTool(
  skillId: string, declaration: ToolDefinition,
): ToolDefinition | undefined {
  if (declaration.executorType !== 'builtin'
    || declaration.executorFile !== undefined || declaration.executorTemplate !== undefined) return undefined;
  return bindings.find(binding => binding.skillId === skillId
    && binding.definition.name === declaration.name)?.definition;
}
