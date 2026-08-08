import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io.js';
import { toolRegistryFile } from '../services/data-paths.js';
import { FRAMEWORK_TOOLS, isFrameworkToolName } from './framework/catalog.js';
import type { ToolCatalogEntry, ToolDefinition } from './tool-definition.js';

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

function validateCustomTool(value: unknown): ToolDefinition {
  if (!value || typeof value !== 'object') throw new Error('工具定义必须是对象');
  const tool = value as ToolDefinition;
  if (!TOOL_NAME.test(tool.name ?? '')) throw new Error(`工具名称无效：${tool.name ?? ''}`);
  if (isFrameworkToolName(tool.name)) throw new Error(`框架工具不可覆盖：${tool.name}`);
  if (typeof tool.description !== 'string' || !tool.description.trim()) throw new Error(`工具缺少描述：${tool.name}`);
  if (!tool.parameters || typeof tool.parameters !== 'object') throw new Error(`工具参数必须是 object schema：${tool.name}`);
  if (tool.executorType !== 'custom' && tool.executorType !== 'template') {
    throw new Error(`自定义工具只允许 custom 或 template 执行器：${tool.name}`);
  }
  if (tool.executionMode !== undefined && tool.executionMode !== 'sync' && tool.executionMode !== 'detachable') {
    throw new Error(`工具执行模式无效：${tool.name}`);
  }
  return {
    ...tool,
    name: tool.name.trim(),
    description: tool.description.trim(),
    category: 'custom',
    executionMode: tool.executionMode ?? 'sync',
    parameters: { ...tool.parameters, type: 'object' },
  };
}

export async function readCustomTools(dataDir: string): Promise<ToolDefinition[]> {
  try {
    const value = JSON.parse(await fs.readFile(toolRegistryFile(dataDir), 'utf8')) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(item => item && typeof item === 'object')
      .filter(item => !isFrameworkToolName((item as ToolDefinition).name))
      .map(item => {
        const tool = item as ToolDefinition;
        return { ...tool, executionMode: tool.executionMode === 'detachable' ? 'detachable' : 'sync' };
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function replaceCustomTools(dataDir: string, input: unknown): Promise<ToolDefinition[]> {
  if (!Array.isArray(input)) throw new Error('tools 必须是数组');
  const tools = input.map(validateCustomTool);
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`工具名称重复：${tool.name}`);
    names.add(tool.name);
  }
  await fs.mkdir(path.dirname(toolRegistryFile(dataDir)), { recursive: true });
  await atomicWriteFile(toolRegistryFile(dataDir), JSON.stringify(tools, null, 2));
  return tools;
}

export async function listToolCatalog(dataDir: string): Promise<ToolCatalogEntry[]> {
  const custom = await readCustomTools(dataDir);
  return [
    ...FRAMEWORK_TOOLS.map(tool => ({ ...tool, source: 'framework' as const, readonly: true })),
    ...custom.map(tool => ({ ...tool, source: 'custom' as const, readonly: false })),
  ];
}
