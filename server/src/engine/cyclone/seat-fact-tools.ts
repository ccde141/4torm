import path from 'node:path';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { frameworkError } from '../shared/framework-error.js';

export interface SeatFactScope { workshopId: string; seatId: string }
export type SeatFactTool = 'seat_activity_read' | 'seat_dispatch_read';
export type SeatFactReader = (
  scope: SeatFactScope, tool: SeatFactTool, args: Record<string, string>,
) => Promise<unknown>;

// The feature owns the fact source. Executors retain only its read port, never a
// second copy of run state; background dispatches use the same source as the UI.
const readers = new Map<string, Set<SeatFactReader>>();

export function registerSeatFactReader(dataDir: string, reader: SeatFactReader): () => void {
  const key = path.resolve(dataDir);
  const group = readers.get(key) ?? new Set<SeatFactReader>();
  group.add(reader); readers.set(key, group);
  return () => { group.delete(reader); if (!group.size) readers.delete(key); };
}

export function isSeatFactTool(tool: string): tool is SeatFactTool {
  return tool === 'seat_activity_read' || tool === 'seat_dispatch_read';
}

export async function executeSeatFactTool(
  dataDir: string, scope: SeatFactScope, tool: SeatFactTool, args: Record<string, string>,
): Promise<string> {
  const reader = [...(readers.get(path.resolve(dataDir)) ?? [])].at(-1);
  if (!reader) throw frameworkError({ code: 'CYCLONE_SEAT_FACTS_UNAVAILABLE', kind: 'io',
    message: '本工位事实查询尚未就绪，请稍后重试', source: 'cyclone.seat-facts', retryable: false });
  return JSON.stringify(await reader(scope, tool, args));
}

export function withSeatFactTools(tools: ToolDef[]): ToolDef[] {
  const names = new Set(tools.map(tool => tool.name));
  return [...tools, ...seatFactToolDefs().filter(tool => !names.has(tool.name))];
}

export function seatFactGuidance(scene: 'solo' | 'room' | 'contact'): string {
  const report = scene === 'solo'
    ? '给人类的回复末尾，简短说明与当前任务有关的新增回报、仍未完成的派发或需要人类处理的阻塞；没有待跟进项时不必机械添加。'
    : scene === 'room'
      ? '在本轮简报中只同步与当前公共任务有关的派发进展，不公开其他私聊或无关任务内容。'
      : '向委托方回报时，同时说明与这次委托有关、仍未收齐的回报或阻塞。';
  return `## 跟进自己的工作\n\n上下文完整时直接继续，不必每轮通读履历和记忆。隔日接续、压缩后缺少细节、职责变更或信息矛盾时，可用 seat_activity_read 按需查看本工位履历，用已有工位记忆工具读取需要的记忆正文。身份由框架绑定，不需要填写工作室或工位 ID。\n\n- 开始或接续工作时，结合已有上下文、任务板和回执，记得自己此前交办过的事项；不确定时主动查询，不凭印象假定已经完成\n- 查询履历可用 filter=work 关注执行与协作，filter=changes 核对岗位或记忆变更；需要更早记录时使用 nextCursor 续读。履历说明发生过什么，任务当前状态仍以派发和执行事实为准\n- 派发后先完成自己可以推进的工作，收尾前再用 seat_dispatch_read 核对一次有关派发；已完成则按需读取正文，仍未完成则如实说明，必要且允许时用 contact 询问对方进展\n- 查询不会重复执行任务，也不应为了催办而再次 dispatch 同一任务；避免连续轮询或空等，正在执行不代表失败\n- ${report}\n\n例如：你先把资料核验交给同事，自己完成文稿后，查询发现对方仍在核验，就在结尾说明“文稿已完成；资料核验仍在进行，尚未收到最终结论”，而不是把整个项目宣称为已完成。`;
}

function seatFactToolDefs(): ToolDef[] {
  return [
    { name: 'seat_activity_read',
      description: '查看本工位在当前工作室的统计、执行协作与岗位变更履历，以及尚在排队/执行/等待人类的派发数量。支持筛选和翻页。身份由框架绑定，无需填写工作室或工位ID。',
      parameters: { type: 'object', additionalProperties: false,
        properties: {
          filter: { type: 'string', enum: ['all', 'work', 'changes'], description: '履历筛选，默认all；work为执行与协作，changes为岗位及记忆变更' },
          cursor: { type: 'string', description: '返回的nextCursor，保持筛选条件续读；记录变化后重新读取第一页' },
          limit: { type: 'integer', minimum: 1, maximum: 12,
          description: '近期事项数量，默认8，最多12' } } } },
    { name: 'seat_dispatch_read',
      description: '核对本工位发出或收到的派发及其真实状态，不启动或重放任务。默认列出自己发出的任务；可筛选未完成项。指定dispatchId后分段读取任务、回报或错误，查询不代替下一次执行时的回执投递。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        direction: { type: 'string', enum: ['outgoing', 'incoming'], description: '列表方向，默认outgoing' },
        status: { type: 'string', enum: ['all', 'open', 'queued', 'running', 'awaiting_human', 'completed', 'failed'],
          description: '列表筛选，默认all；open包括排队、执行中和等待人类' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '列表每页数量，默认8' },
        cursor: { type: 'string', description: '列表返回的nextCursor；状态变化后重新读取第一页' },
        dispatchId: { type: 'string', description: '读取正文时填写本工位参与的派发ID' },
        part: { type: 'string', enum: ['task', 'response', 'error'], description: '正文部分，默认response' },
        offset: { type: 'integer', minimum: 0, description: '正文续读位置，默认0' },
      } } },
  ];
}
