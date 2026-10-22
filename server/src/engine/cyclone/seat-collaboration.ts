import type { SeatData } from './types.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { frameworkError } from '../shared/framework-error.js';
import { loadSeat } from './seat-store.js';

export interface SeatCollaborationPolicy { contact: boolean; dispatch: boolean; bulletin: boolean }
export type SeatCollaborationTool = keyof SeatCollaborationPolicy;

/** 缺省保持旧版全部开放；策略属于本岗位，不回写池化 Agent。 */
export function seatCollaborationPolicy(seat: Pick<SeatData, 'collaboration'>): SeatCollaborationPolicy {
  return { contact: seat.collaboration?.contact ?? true,
    dispatch: seat.collaboration?.dispatch ?? true, bulletin: seat.collaboration?.bulletin ?? true };
}

export function isSeatCollaborationTool(tool: string): tool is SeatCollaborationTool {
  return tool === 'contact' || tool === 'dispatch' || tool === 'bulletin';
}

export function filterSeatCollaborationTools(tools: ToolDef[], policy?: SeatCollaborationPolicy): ToolDef[] {
  return tools.filter(tool => !isSeatCollaborationTool(tool.name) || policy?.[tool.name] !== false);
}

/** 执行时再读可信岗位策略，防止旧 schema 或文本调用绕过关闭项。 */
export async function assertSeatCollaborationTool(
  dataDir: string, workshopId: string, seatId: string, tool: string,
): Promise<void> {
  if (!isSeatCollaborationTool(tool)) return;
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) throw frameworkError({ code: 'CYCLONE_SEAT_NOT_FOUND', kind: 'not_found',
    message: '工位不存在', source: 'cyclone.seats', retryable: false });
  if (!seatCollaborationPolicy(seat)[tool]) throw frameworkError({
    code: 'CYCLONE_SEAT_COLLABORATION_DISABLED', kind: 'permission',
    message: `本工位未开放 ${tool} 协作能力`, source: 'cyclone.seats', retryable: false,
  });
}
