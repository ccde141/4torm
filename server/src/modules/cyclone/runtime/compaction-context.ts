import type { CompactionRequestContext } from '../../../engine/shared/compaction/contracts.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { buildSeatRequestContext } from '../../../engine/cyclone/current-input.js';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { loadRoom } from '../../../engine/cyclone/room-store.js';
import { loadWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { loadSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { buildSupervisorRequestContext } from '../../../engine/cyclone/supervisor-runner.js';
import { buildChairPrompt } from '../../../engine/cyclone/seat-prompt.js';
import type { CycloneSummaryInput } from '../domain/context-summary.js';

/** Reuse the selected role's request builders without borrowing a participant's identity. */
export async function buildCycloneCompactionContext(dataDir: string, agent: LoadedAgent,
  target?: CycloneSummaryInput['target']): Promise<CompactionRequestContext> {
  if (!target) return { messages: [{ role: 'system', content: agent.rolePrompt }] };
  if (target.kind === 'seat') {
    const seat = await loadSeat(dataDir, target.workshopId, target.id);
    if (!seat) throw new Error('工位不存在');
    const built = await buildSeatRequestContext(dataDir, target.workshopId, seat, agent);
    return { messages: built.messages.slice(0, 1), tools: built.tools,
      historyToolTransport: built.historyToolTransport };
  }
  if (target.kind === 'supervisor') {
    const supervisor = await loadSupervisor(dataDir, target.workshopId);
    const native = (await resolveNativeMode(dataDir, agent.model)).native;
    const hint = [...supervisor.messages].reverse().find(message => message.role === 'user')?.content ?? '';
    const built = await buildSupervisorRequestContext(dataDir, target.workshopId, supervisor, agent, native, hint);
    return { messages: built.messages.slice(0, 1), ...(native ? { tools: built.tools } : {}),
      historyToolTransport: native ? 'native' : 'text' };
  }
  const [workshop, room] = await Promise.all([
    loadWorkshop(dataDir, target.workshopId), loadRoom(dataDir, target.workshopId, target.id),
  ]);
  if (!workshop || !room) throw new Error('工作室或群聊不存在');
  const built = await buildChairPrompt(dataDir, target.workshopId, room, workshop, agent);
  return { messages: [built.systemMessage] };
}
