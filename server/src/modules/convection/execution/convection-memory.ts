import {
  buildMemoryToolDefs,
  execMemoryTool,
  MEMORY_TOOL_NAMES,
  recallMemory,
} from '../../../engine/shared/agent-memory.js';
import type { ToolDef } from '../../../engine/shared/tool-defs-loader.js';

const MEMORY_GUIDANCE = `## 你的长期记忆

你沿用当前 Agent 的跨会话、跨功能区长期记忆。召回内容只属于你，不代表其他参会者的立场，也不会自动写入公共会议记录。

- 用户明确要求“记住”、给出长期偏好或纠正时，应写入记忆
- 可跨任务复用的事实、踩坑与资源指针值得记录
- 保存或修改前先 recall_search(kind=memory) 查同主题或旧版本，再 recall_read(id) 核对正文和 updated。已有条目用 memory_manage(action=update) 合并或修正，没有合适条目才用 action=create；暂时不用用 action=archive，恢复用 action=restore，确认过时或合并后可用 action=delete。除create外携带原memory:ID和expectedUpdated，冲突后重新读取。
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
