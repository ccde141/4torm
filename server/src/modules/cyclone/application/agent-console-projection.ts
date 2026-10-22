import type {
  CycloneConsoleEvent, CycloneConsoleSeat, CycloneConsoleSeatFacts, CycloneWorkshopConsole,
} from '../domain/console.js';

/** Keep the Agent view independent of the human console's full read model. */
export function collaborationConsoleHeader(value: CycloneWorkshopConsole) {
  return { workshopId: value.workshopId, title: value.title.slice(0, 200),
    titleTruncated: value.title.length > 200, capturedAt: value.capturedAt,
    ...(value.supervisor ? { supervisor: value.supervisor } : {}),
    stats: { ...value.stats }, recent: value.recent.slice(0, 6).map(collaborationConsoleEvent),
    recentTruncated: value.recent.length > 6 };
}

export function collaborationSeatSummary(value: CycloneConsoleSeatFacts) {
  return { seatId: value.id, agentId: value.agentId, title: value.title.slice(0, 120),
    duty: (value.duty ?? '').slice(0, 240), pending: value.pending,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    stats: { ...value.stats }, collaboration: { ...value.collaboration },
    textTruncated: value.title.length > 120 || (value.duty?.length ?? 0) > 240,
    ...(value.error ? { error: value.error.slice(0, 240), errorTruncated: value.error.length > 240 } : {}) };
}

export function collaborationSeatDetail(value: CycloneConsoleSeat) {
  return { ...collaborationSeatSummary(value), rolePrompt: value.rolePrompt.slice(0, 3_000),
    rolePromptTruncated: value.rolePrompt.length > 3_000, overrideAgentRole: value.overrideAgentRole,
    recent: value.recent.slice(0, 6).map(collaborationConsoleEvent), recentTruncated: value.recent.length > 6,
    capabilities: { available: value.capabilities.available,
      agentName: value.capabilities.agentName.slice(0, 120),
      model: value.capabilities.model.slice(0, 240),
      textTruncated: value.capabilities.agentName.length > 120 || value.capabilities.model.length > 240,
      toolCount: value.capabilities.tools.length, skillCount: value.capabilities.skills.length } };
}

export function collaborationCapabilities(value: CycloneConsoleSeat) {
  return [
    ...value.capabilities.tools.map(tool => ({ kind: 'tool' as const, name: tool.name.slice(0, 160),
      description: tool.description.slice(0, 240),
      textTruncated: tool.name.length > 160 || tool.description.length > 240 })),
    ...value.capabilities.skills.map(skill => ({ kind: 'skill' as const, id: skill.id,
      name: skill.name.slice(0, 160), description: skill.description.slice(0, 240),
      textTruncated: skill.name.length > 160 || skill.description.length > 240 })),
  ];
}

export function collaborationConsoleEvent(value: CycloneConsoleEvent) {
  return { id: value.id, seatId: value.seatId, seatTitle: value.seatTitle.slice(0, 120),
    kind: value.kind, title: value.title.slice(0, 160), status: value.status,
    startedAt: value.startedAt, updatedAt: value.updatedAt,
    textTruncated: value.seatTitle.length > 120 || value.title.length > 160
      || (value.sourceTitle?.length ?? 0) > 120,
    ...(value.sourceTitle ? { sourceTitle: value.sourceTitle.slice(0, 120) } : {}),
    ...(value.operationId ? { operationId: value.operationId } : {}),
    ...(value.runId ? { runId: value.runId } : {}),
    ...(value.roomId ? { roomId: value.roomId } : {}),
    ...(value.dispatchId ? { dispatchId: value.dispatchId } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(value.changedFields ? { changedFields: value.changedFields } : {}),
    ...(value.previousAgentId ? { previousAgentId: value.previousAgentId } : {}),
    ...(value.agentId ? { agentId: value.agentId } : {}),
    ...(value.memoryId ? { memoryId: value.memoryId } : {}),
    ...(value.memoryTitle ? { memoryTitle: value.memoryTitle.slice(0, 200),
      memoryTitleTruncated: value.memoryTitle.length > 200 } : {}),
    ...(value.memoryRevision === undefined ? {} : { memoryRevision: value.memoryRevision }),
    ...(value.error ? { error: value.error.slice(0, 240), errorTruncated: value.error.length > 240 } : {}) };
}
