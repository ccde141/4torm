import {
  buildMemoryToolDefs,
  execMemoryTool,
  MEMORY_TOOL_NAMES,
  recallMemory,
} from '../shared/agent-memory.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';

const MEMORY_GUIDANCE = `## 你的长期记忆

你沿用当前 Agent 的跨会话、跨功能区长期记忆。召回内容只属于你，不代表其他参会者的立场，也不会自动写入公共会议记录。

- 用户明确要求“记住”、给出长期偏好或纠正时，应写入记忆
- 可跨任务复用的事实、踩坑与资源指针值得记录
- 写入前先 memory_list，已有同类则不要重复
- 不要把其他参会者的一次性观点当作你的长期事实`;

export function withConvectionMemoryTools(toolDefs: ToolDef[]): ToolDef[] {
  const names = new Set(toolDefs.map(tool => tool.name));
  return [...toolDefs, ...buildMemoryToolDefs().filter(tool => !names.has(tool.name))];
}

export function isConvectionMemoryTool(tool: string): boolean {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(tool);
}

export async function executeConvectionMemoryTool(
  dataDir: string,
  agentId: string,
  tool: string,
  args: Record<string, string>,
): Promise<string | null> {
  if (!isConvectionMemoryTool(tool)) return null;
  return execMemoryTool(dataDir, agentId, 'convection', tool, args);
}

export async function buildConvectionMemoryPrompt(
  dataDir: string,
  agentId: string,
  taskHint: string,
): Promise<string> {
  const recalled = await recallMemory(dataDir, agentId, taskHint);
  return [recalled, MEMORY_GUIDANCE].filter(Boolean).join('\n\n');
}
