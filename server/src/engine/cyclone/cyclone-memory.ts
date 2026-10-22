import {
  buildMemoryToolDefs,
  execMemoryTool,
  MEMORY_TOOL_NAMES,
  recallMemory,
} from '../shared/agent-memory.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { readSeatMemory, saveSeatMemory } from './seat-memory.js';

interface SeatMemoryScope { workshopId: string; seatId: string }
const SEAT_MEMORY_TOOLS = ['seat_memory_read', 'seat_memory_write'];

const MEMORY_GUIDANCE = `## 你的长期记忆

你沿用绑定 Agent 的跨会话、跨功能区长期记忆。相关经验已在上方召回；需要检查时使用 memory_list、memory_read。

- 本工作室的职责经验、资料索引、项目事实与纠正默认写入本工位记忆 seat_memory_write，不写到绑定 Agent 的通用记忆
- 只有明确适合跨项目复用的偏好、方法或经验，才用 memory_write 写入绑定 Agent 的通用记忆
- 写入前先 memory_list，已有同类则不要重复`;

export function withCycloneMemoryTools(toolDefs: ToolDef[], scope?: SeatMemoryScope): ToolDef[] {
  const names = new Set(toolDefs.map(tool => tool.name));
  const additions = [...buildMemoryToolDefs(), ...(scope ? seatMemoryToolDefs() : [])];
  return [...toolDefs, ...additions.filter(tool => !names.has(tool.name))];
}

export function isCycloneMemoryTool(tool: string): boolean {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(tool) || SEAT_MEMORY_TOOLS.includes(tool);
}

export async function executeCycloneMemoryTool(
  dataDir: string,
  agentId: string,
  tool: string,
  args: Record<string, string>,
  scope?: SeatMemoryScope,
): Promise<string | null> {
  if (!isCycloneMemoryTool(tool)) return null;
  if (SEAT_MEMORY_TOOLS.includes(tool)) {
    if (!scope) throw new Error('本轮没有工位记忆作用域');
    return executeSeatMemoryTool(dataDir, scope, tool, args);
  }
  return execMemoryTool(dataDir, agentId, 'cyclone', tool, args);
}

export async function buildCycloneMemoryPrompt(
  dataDir: string,
  agentId: string,
  taskHint: string,
  scope?: SeatMemoryScope,
): Promise<string> {
  const recalled = await recallMemory(dataDir, agentId, taskHint);
  const seatMemory = scope ? await readSeatMemory(dataDir, scope.workshopId, scope.seatId) : undefined;
  const index = seatMemory?.entries.slice(-20).reverse().map(entry => `- ${entry.id}：${entry.title}`).join('\n');
  const local = seatMemory ? `## 本工位记忆\n\n这些记忆属于当前工作室和工位，更换绑定 Agent 后仍保留。私聊、同事联络和群聊副本共享这份岗位记忆。用 seat_memory_read 按 id 读取正文；写入前先读最新 revision，发生冲突时重新读取后合并，不覆盖他人的修改。\n\n${index || '（尚无工位记忆）'}` : '';
  return [recalled, MEMORY_GUIDANCE, local].filter(Boolean).join('\n\n');
}

function seatMemoryToolDefs(): ToolDef[] {
  return [
    { name: 'seat_memory_read', description: '读取本工位记忆索引和当前 revision；传 id 可读取一条完整正文。仅属于本工作室的本工位，不需要填写身份。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '可选记忆条目 id；不传则返回索引' } } } },
    { name: 'seat_memory_write', description: '新增或更新本工位记忆。项目经验、岗位资料索引与已确认事实默认记在这里；先 read 获取 revision，冲突后重新读取并合并。不会改写池中 Agent 的通用记忆。',
      parameters: { type: 'object', properties: {
        expectedRevision: { type: 'integer', description: '最近一次读取的 revision；空记忆为 0' },
        id: { type: 'string', description: '更新已有条目时填写；新增不填' },
        title: { type: 'string', description: '简短标题，最多 200 字' },
        content: { type: 'string', description: '记忆正文：事实、适用前提、证据或资料位置' },
      }, required: ['expectedRevision', 'title', 'content'] } },
  ];
}

async function executeSeatMemoryTool(
  dataDir: string, scope: SeatMemoryScope, tool: string, args: Record<string, string>,
): Promise<string> {
  const keys = tool === 'seat_memory_read' ? ['id'] : ['expectedRevision', 'id', 'title', 'content'];
  if (Object.keys(args).some(key => !keys.includes(key))) throw new Error('工位记忆参数无效');
  if (tool === 'seat_memory_read') {
    const board = await readSeatMemory(dataDir, scope.workshopId, scope.seatId);
    if (args.id !== undefined) {
      const entry = board.entries.find(item => item.id === args.id);
      if (!entry) throw new Error('工位记忆条目不存在');
      return JSON.stringify({ revision: board.revision, entry });
    }
    return JSON.stringify({ revision: board.revision, entries: board.entries.map(({ content: _content, ...entry }) => entry) });
  }
  const revision = String(args.expectedRevision ?? '');
  if (!/^\d+$/.test(revision)) throw new Error('expectedRevision 必须是读取过的非负整数');
  const board = await saveSeatMemory(dataDir, scope.workshopId, scope.seatId, Number(revision), {
    ...(args.id === undefined ? {} : { id: args.id }), title: args.title, content: args.content,
  }, 'seat-agent');
  const entry = args.id ? board.entries.find(item => item.id === args.id) : board.entries.at(-1);
  return JSON.stringify({ revision: board.revision, entry });
}
