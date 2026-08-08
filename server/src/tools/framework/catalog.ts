import rawCatalog from './catalog.json';
import type { ToolDefinition } from '../tool-definition.js';

/**
 * 4torm 框架内置工具的唯一清单。
 *
 * 这些定义随代码发布，不从 data/tools/registry.json 读取，也不能被用户数据覆盖。
 * data/tools/registry.json 只保存用户自定义工具。
 */
export const FRAMEWORK_TOOLS = Object.freeze(
  (rawCatalog as unknown as ToolDefinition[]).map(tool => Object.freeze({ ...tool })),
);

const frameworkByName = new Map(FRAMEWORK_TOOLS.map(tool => [tool.name, tool]));

export function findFrameworkTool(name: string): ToolDefinition | undefined {
  return frameworkByName.get(name);
}

export function isFrameworkToolName(name: string): boolean {
  return frameworkByName.has(name);
}
