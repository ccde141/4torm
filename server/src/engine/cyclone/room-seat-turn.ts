import { withAgentActivity } from '../shared/agent-activity.js';
import type { SeatData } from './types.js';

interface FreshSeatTurnDeps<T> {
  load: () => Promise<SeatData | null>;
  run: (seat: SeatData) => Promise<T>;
}

/** 每轮执行前重新读取工位，避免沿用群聊开始时的旧配置。 */
export async function runFreshSeatTurn<T>(
  queuedSeat: SeatData,
  deps: FreshSeatTurnDeps<T>,
): Promise<T> {
  return withAgentActivity(queuedSeat.agentId, 'cyclone', async () => {
    const current = await deps.load();
    if (!current) throw new Error(`工位 ${queuedSeat.id} 不存在，跳过`);
    if (current.agentId !== queuedSeat.agentId) {
      throw new Error(`工位「${queuedSeat.title}」已更换 Agent，本轮已跳过`);
    }
    return deps.run(current);
  });
}
