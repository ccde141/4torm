import { loadAgent } from '../../shared/agent-loader.js';
import { estimateCurrentInput, resolveNativeMode } from '../../shared/llm-bridge.js';
import type { CurrentInputEstimate } from '../../shared/model-request-usage.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { buildMeetingAgentPrompt, buildMeetingChairSystem } from './meeting-handlers.js';
import { meetingContextMessages } from './meeting-compaction-context.js';
import { buildChairContext } from './chair-context-compaction.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import type { MeetingSessionData } from './meeting-session.js';

/** Public participants have distinct role/tool costs; expose the largest effective input. */
export async function estimateMeetingCurrentInput(dataDir: string, session: MeetingSessionData, workspace: string) {
  const participants = await Promise.all(session.participants.map(async participant => {
    const agent = await loadAgent(dataDir, participant.agentId);
    if (!agent) return undefined;
    try {
      const native = (await resolveNativeMode(dataDir, agent.model)).native;
      const tools = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);
      const targets = session.participants.filter(item => item.nodeId !== participant.nodeId)
        .map(item => ({ label: item.label, role: '会议参与者' }));
      return estimateCurrentInput({ dataDir, fullModelKey: agent.model,
        messages: [{ role: 'system', content: buildMeetingAgentPrompt(agent,
          session.participants.map(item => item.label), session, tools, workspace, participant.label,
          session.meetingLabel, dataDir, targets, native) }, ...meetingContextMessages(session.publicMessages)],
        ...(native ? { tools: [...tools, ...buildVirtualToolDefs({ allowDelegate: false,
          contactTargets: targets.map(item => item.label) })] } : {}) });
    } catch {
      return { ...await estimateCurrentInput({ dataDir, fullModelKey: agent.model,
        messages: [{ role: 'system', content: agent.rolePrompt }, ...meetingContextMessages(session.publicMessages)] }),
      basis: 'canonical' as const };
    }
  }));
  const publicInput = participants.filter((item): item is CurrentInputEstimate => !!item)
    .reduce<CurrentInputEstimate | undefined>((largest, item) => !largest || item.tokens > largest.tokens ? item : largest, undefined);
  const chair = await loadAgent(dataDir, session.chairAgentId);
  const chairInput = chair ? await estimateCurrentInput({ dataDir, fullModelKey: chair.model,
    messages: buildChairContext(buildMeetingChairSystem(chair, session), session) }) : undefined;
  return { public: publicInput, chair: chairInput };
}
