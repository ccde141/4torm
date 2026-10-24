import { withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { logModelDiagnostic } from '../../../config/developer-mode.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { frameworkTransportErrorFromUnknown } from '../../../engine/shared/framework-error-transport.js';
import { saveSession, type ConvectionSessionData } from '../infrastructure/session-store.js';
import { runConvectionReAct, type AgentReActResult, type ConvectionReActEvent } from './convection-react-adapter.js';
import { appendConvectionReasoning, buildConvectionMessage } from './convection-reasoning.js';
import { resolveConvectionContent } from './convection-outcome.js';
import { runConvectionReActNative } from './native-adapter.js';
import { buildAgentMessages } from './participant-context.js';
import { runParticipantSequence } from './participant-sequence.js';
import { createConvectionCompactionCaller } from './compaction-caller.js';
import { loadRequiredAgent, loadRoundAgents, roundAgent, type RoundAgentSnapshot } from './round-agent-snapshot.js';
import { recordPublicUsage } from './session-view.js';
import type { ConvectionEventSink } from './stream-events.js';
import { withConvectionModelUsage } from './model-usage.js';

export async function handleSpeak(
  dataDir: string,
  session: ConvectionSessionData,
  humanMessage: string,
  emit?: ConvectionEventSink,
  signal?: AbortSignal,
  runId?: string,
): Promise<void> {
  // 人类输入已开启新一轮；即使压缩前进程退出，也不展示上一轮的最近请求。
  session.publicLatestTokenUsage = undefined;
  session.compactionNotice = undefined;
  session.compactionProgress = undefined;
  session.publicMessages.push({ speaker: '人类', content: humanMessage, timestamp: Date.now(),
    ...(runId ? { runId } : {}) });
  await saveSession(dataDir, session);
  emit?.({ type: 'input-accepted' });
  const agents = await loadRoundAgents(dataDir,
    [...session.participantAgentIds, session.chairAgentId]);
  await saveSession(dataDir, session);
  emit?.({ type: 'usage', usage: null });
  await withConvectionModelUsage(dataDir, session, 'public', emit,
    observed => runSequence({ dataDir, session, agents, emit: observed, signal, runId }));
  await saveSession(dataDir, session);
}

interface SequenceContext {
  dataDir: string;
  session: ConvectionSessionData;
  agents: RoundAgentSnapshot;
  emit?: ConvectionEventSink;
  signal?: AbortSignal;
  runId?: string;
}

async function runSequence(context: SequenceContext): Promise<void> {
  const { dataDir, session, agents, emit, signal } = context;
  await runParticipantSequence({
    participantIds: session.participantAgentIds, signal,
    execute: agentId => executeParticipant(context, agentId),
    commit: () => saveSession(dataDir, session),
    reportFailure: async (agentId, error) => {
      const failure = frameworkTransportErrorFromUnknown(error, 'convection.participant');
      emit?.({ type: 'agent-failed', agentId, label: agents.get(agentId)?.name ?? agentId,
        message: failure.message, code: failure.code, kind: failure.kind });
      await saveSession(dataDir, session);
    },
  });
}

async function executeParticipant(context: SequenceContext, agentId: string): Promise<void> {
  const { dataDir, session, agents, emit, signal } = context;
  const agent = roundAgent(agents, agentId);
  emit?.({ type: 'agent-start', agentId, label: agent.name });
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  logModelDiagnostic(`[convection] ${agent.name} (${agent.model}) → tools=${native ? 'structured' : 'text'}`);
  const execution = await withAgentActivity(agentId, 'convection', () => (
    runParticipantModel(dataDir, session, agent, native, emit, signal)
  ));
  persistParticipantResult(session, agent, execution.result, execution.reasoning, emit, context.runId);
}

async function runParticipantModel(
  dataDir: string,
  session: ConvectionSessionData,
  agent: LoadedAgent,
  native: boolean,
  emit?: ConvectionEventSink,
  signal?: AbortSignal,
): Promise<{ result: AgentReActResult; reasoning: string }> {
  let reasoning = '';
  const forward = (event: ConvectionReActEvent) => {
    if (event.type === 'reasoning') reasoning += event.chunk ?? '';
    if (event.type === 'usage') {
      emit?.({ type: 'usage', usage: session.publicLatestTokenUsage ?? null });
      return;
    }
    forwardParticipantEvent(event, agent.id, emit);
  };
  const built = await buildAgentMessages(dataDir, session, agent, native);
  const chair = await loadRequiredAgent(dataDir, session.chairAgentId);
  const common = { dataDir, model: built.agent.model, temperature: built.agent.temperature,
    agentId: agent.id, sessionId: session.id, label: built.agent.name,
    messages: built.messages, onEvent: forward, signal,
    llm: createConvectionCompactionCaller({ dataDir, session, agent, chair,
      messages: built.messages, kind: 'public', emit }),
    onUsage: async (usage: import('../../../engine/shared/llm-bridge.js').TokenUsage | null) => {
      recordPublicUsage(session, usage);
      await saveSession(dataDir, session);
    } };
  const result = native
    ? await runConvectionReActNative({ ...common, toolDefs: built.toolDefs })
    : await runConvectionReAct({ ...common, allowedTools: built.toolDefs.map(tool => tool.name) });
  return { result, reasoning };
}

function forwardParticipantEvent(
  event: ConvectionReActEvent,
  agentId: string,
  emit?: ConvectionEventSink,
): void {
  if (!emit) return;
  if (event.type === 'model-request' && event.request) emit({ type: 'model-request', request: event.request });
  else if (event.type === 'token') emit({ type: 'token', agentId, label: event.label, chunk: event.chunk! });
  else if (event.type === 'reasoning') emit({ type: 'reasoning', agentId, label: event.label, chunk: event.chunk! });
  else if (event.type === 'tool-call') emit({ type: 'tool-call', agentId, label: event.label,
    tool: event.tool!, args: event.args! });
  else if (event.type === 'tool-result') emit({ type: 'tool-result', agentId, label: event.label,
    tool: event.tool!, result: event.result!,
    ...(event.toolImages?.length ? { toolImages: event.toolImages } : {}),
    ...(event.ok !== undefined ? { ok: event.ok } : {}) });
  else if (event.type === 'heartbeat') emit({ type: 'heartbeat', agentId, label: event.label,
    phase: event.phase!, elapsed: event.elapsed! });
}

function persistParticipantResult(
  session: ConvectionSessionData,
  agent: LoadedAgent,
  result: AgentReActResult,
  reasoning: string,
  emit?: ConvectionEventSink,
  runId?: string,
): void {
  const content = resolveConvectionContent(result.cleanContent, result.termination);
  if (!content) return;
  session.publicMessages.push({ ...buildConvectionMessage({
    agentId: agent.id, speaker: agent.name, content, timestamp: Date.now(),
    rawContent: result.rawContent || undefined, reasoning: reasoning || undefined,
    toolCalls: result.toolCalls,
  }), ...(runId ? { runId } : {}) });
  emit?.({ type: 'agent-done', agentId: agent.id, label: agent.name, content,
    rawContent: result.rawContent, reasoning: reasoning || undefined, toolCalls: result.toolCalls });
}
