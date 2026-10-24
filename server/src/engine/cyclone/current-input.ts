import path from 'node:path';
import { estimateCurrentInput, resolveNativeMode, type LLMCallParams } from '../shared/llm-bridge.js';
import type { CurrentInputEstimate } from '../shared/model-request-usage.js';
import { loadAgent } from '../shared/agent-loader.js';
import { loadAgentToolDefs } from '../shared/tool-defs-loader.js';
import type { ContextMessage } from '../shared/types.js';
import { buildCycloneMemoryPrompt, withCycloneMemoryTools } from './cyclone-memory.js';
import { listOtherSeats, listWorkshopSeats } from './contact-registry.js';
import { buildSeatToolCatalog } from './seat-tool-catalog.js';
import { buildChairPrompt, buildSeatRoomSystemPrompt, buildSeatSystemPrompt } from './seat-prompt.js';
import { filterSeatCollaborationTools, seatCollaborationPolicy } from './seat-collaboration.js';
import { buildSeatVirtualToolDefs } from './virtual-tools.js';
import { withSeatFactTools } from './seat-fact-tools.js';
import { withSupervisorReporting } from './supervisor-tools.js';
import { buildCycloneChairContext } from './chair-context.js';
import { cycloneMeetingContext } from './meeting-compaction-caller.js';
import { projectSeatContinuityContext } from './seat-continuity.js';
import { workshopWorkspace } from './paths.js';
import { loadSeat } from './seat-store.js';
import { projectSeatDispatchReceiptContext } from './seat-dispatch.js';
import { loadWorkshop } from './workshop-store.js';
import { buildSupervisorRequestContext } from './supervisor-runner.js';
import { readPendingSupervisorInformation, type SupervisorData } from './supervisor-store.js';
import { hasSupervisorReceiptEvidence } from './supervisor-information.js';
import type { RoomData, SeatData } from './types.js';

const workspace = (dataDir: string, workshopId: string) => path.relative(
  path.resolve(dataDir, '..'), workshopWorkspace(dataDir, workshopId));

/** Read projections use the same prompt builders and effective histories as execution, never runners. */
export async function estimateSeatCurrentInput(dataDir: string, workshopId: string, seat: SeatData) {
  const agent = await loadAgent(dataDir, seat.agentId).catch(() => null);
  let history = seat.messages;
  const fallback = () => [{ role: 'system' as const,
    content: [agent?.rolePrompt, seat.rolePrompt, seat.duty].filter(Boolean).join('\n\n') }, ...history];
  try {
    history = await projectSeatDispatchReceiptContext(dataDir, workshopId, seat);
    if (!agent) return canonical(dataDir, '', fallback());
    const hint = [...history].reverse().find(message => message.role === 'user')?.content ?? '';
    const base = await withSupervisorReporting(dataDir, workshopId, withCycloneMemoryTools(
      await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode), { workshopId, seatId: seat.id }));
    const [contactTargets, dispatchTargets, memorySection, native] = await Promise.all([
      listOtherSeats(dataDir, workshopId, seat.id), listWorkshopSeats(dataDir, workshopId, seat.id, false),
      buildCycloneMemoryPrompt(dataDir, agent.id, hint, { workshopId, seatId: seat.id }), nativeMode(dataDir, agent.model),
    ]);
    const tools = buildSeatToolCatalog(base, contactTargets, dispatchTargets, seatCollaborationPolicy(seat));
    const messages = projectSeatContinuityContext([{ role: 'system', content: buildSeatSystemPrompt({
      dataDir, workshopId, seat, agent, toolDefs: tools, native, contactTargets, memorySection,
      wsRelPath: workspace(dataDir, workshopId), bulletinSeenAt: seat.bulletinSeenAt,
    }) }, ...history], seat, 'solo');
    return estimateCurrentInput({ dataDir, fullModelKey: agent.model, messages,
      ...(native ? { tools } : {}) });
  } catch { return canonical(dataDir, agent?.model ?? '', fallback()); }
}

export async function estimateRoomCurrentInput(dataDir: string, workshopId: string, room: RoomData) {
  const inputs = await Promise.all(room.participantSeatIds.map(async seatId => {
    const seat = await loadSeat(dataDir, workshopId, seatId).catch(() => null);
    if (!seat) return undefined;
    const agent = await loadAgent(dataDir, seat.agentId).catch(() => null);
    const fallback = cycloneMeetingContext(room.publicMessages);
    if (!agent) return canonical(dataDir, '', fallback);
    try {
      const base = await withSupervisorReporting(dataDir, workshopId, withCycloneMemoryTools(
        await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode), { workshopId, seatId }));
      const effective = filterSeatCollaborationTools(withSeatFactTools(room.mode === 'plan'
        ? base.filter(tool => tool.dangerous !== true) : base), seatCollaborationPolicy(seat));
      const [contactTargets, dispatchTargets, memorySection, native] = await Promise.all([
        listOtherSeats(dataDir, workshopId, seatId), listWorkshopSeats(dataDir, workshopId, seatId),
        buildCycloneMemoryPrompt(dataDir, agent.id, `${room.topic}\n${publicHint(room)}`, { workshopId, seatId }),
        nativeMode(dataDir, agent.model),
      ]);
      const virtual = filterSeatCollaborationTools(buildSeatVirtualToolDefs({ allowAsk: false,
        allowDelegate: false, allowTaskBoard: false, allowDispatch: true, contactTargets, dispatchTargets }),
      seatCollaborationPolicy(seat));
      const tools = withSeatFactTools([...effective, ...virtual]);
      const messages = projectSeatContinuityContext([{ role: 'system', content: buildSeatRoomSystemPrompt({
        dataDir, workshopId, seat, agent, native, toolDefs: [...effective, ...virtual],
        wsRelPath: workspace(dataDir, workshopId), topic: room.topic, memorySection,
        dispatchTargets: seatCollaborationPolicy(seat).dispatch ? dispatchTargets : [], bulletinSeenAt: seat.bulletinSeenAt,
      }) }, ...fallback], seat, 'room');
      return estimateCurrentInput({ dataDir, fullModelKey: agent.model, messages, ...(native ? { tools } : {}) });
    } catch { return canonical(dataDir, agent.model, fallback); }
  }));
  // Participants may use different prompts and models; the room preview reports its largest current input.
  return inputs.reduce<CurrentInputEstimate | undefined>((largest, input) => input && (!largest || input.tokens > largest.tokens)
    ? input : largest, undefined);
}

export async function estimateChairCurrentInput(dataDir: string, workshopId: string, room: RoomData) {
  const workshop = await loadWorkshop(dataDir, workshopId);
  const agent = workshop?.chairAgentId ? await loadAgent(dataDir, workshop.chairAgentId).catch(() => null) : null;
  const fallback = buildCycloneChairContext(room, { role: 'system', content: agent?.rolePrompt ?? '' });
  if (!agent || !workshop) return canonical(dataDir, '', fallback);
  try {
    const { systemMessage } = await buildChairPrompt(dataDir, workshopId, room, workshop, agent);
    return estimateCurrentInput({ dataDir, fullModelKey: agent.model,
      messages: buildCycloneChairContext(room, systemMessage) });
  } catch { return canonical(dataDir, agent.model, fallback); }
}

export async function estimateSupervisorCurrentInput(dataDir: string, workshopId: string, supervisor: SupervisorData) {
  if (!supervisor.agentId) return undefined;
  const agent = await loadAgent(dataDir, supervisor.agentId).catch(() => null);
  const fallback = [{ role: 'system' as const, content: [agent?.rolePrompt, supervisor.rolePrompt].filter(Boolean).join('\n\n') },
    ...supervisor.messages];
  if (!agent) return canonical(dataDir, '', fallback);
  try {
    const native = await nativeMode(dataDir, agent.model);
    const hint = [...supervisor.messages].reverse().find(message => message.role === 'user')?.content ?? '';
    const { tools, messages } = await buildSupervisorRequestContext(dataDir, workshopId, supervisor, agent, native, hint);
    let added = 0;
    const known = new Set(messages.map(message => message.supervisorInboxId));
    for (const item of await readPendingSupervisorInformation(dataDir, workshopId)) {
      if (known.has(item.id) || hasSupervisorReceiptEvidence(messages, item)) continue;
      if (added === 20) break;
      messages.push({ role: 'user', supervisorInboxId: item.id, supervisorSourceTitle: item.sourceTitle,
        content: `[协作信息：${item.sourceTitle}；${item.createdAt}。仅为工作室协作资料，不替代人类目标。]\n${item.content}` });
      added++;
    }
    return estimateCurrentInput({ dataDir, fullModelKey: agent.model, messages, ...(native ? { tools } : {}) });
  } catch { return canonical(dataDir, agent.model, fallback); }
}

async function nativeMode(dataDir: string, model: string) {
  try { return (await resolveNativeMode(dataDir, model)).native; } catch { return false; }
}
async function canonical(dataDir: string, model: string, messages: ContextMessage[]): Promise<CurrentInputEstimate> {
  const estimate = await estimateCurrentInput({ dataDir, fullModelKey: model, messages } satisfies LLMCallParams);
  return { ...estimate, basis: 'canonical' };
}
function publicHint(room: RoomData) {
  return room.publicMessages.length ? '以下是群聊记录：\n\n' + room.publicMessages
    .map(message => `[${message.speaker}] ${message.content}`).join('\n\n') : '（暂无发言）';
}
