import { SessionRunner } from '../../../engine/conversation/session-runner.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { estimateCompactionTokens, type CompactionProgress } from '../../../engine/shared/compaction/index.js';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import { buildTideInputContext } from './input-context.js';
import { resolveTarget, type ResolvedTarget } from '../sessions/session-resolver.js';
import type { TideMessage } from '../sessions/session-types.js';
import type { TideUsageProgress } from '../domain/token-usage.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { assertTideRunNotTimedOut } from './run-outcome.js';
import { createTideEventState } from './tide-conversation-events.js';
import { TideContextCompaction } from './context-compaction.js';
import type { SeasonSessionPort } from '../sessions/season-session-port.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { tideGeneratedMediaContext } from './turn-context.js';
import type { ModelRequestUsage } from '../../../engine/shared/model-request-usage.js';
import { TideConversationDeadline } from './conversation-deadline.js';

const TIMEOUT_MS = 10 * 60 * 1000;

export interface TideConversationResult {
  agentName: string;
  agentModel: string;
  rolePrompt: string;
  resolved: ResolvedTarget;
  userMessage: string;
  answer: string;
  rawContent: string;
  toolCalls: TideRunRecord['toolCalls'];
  turns: number;
  intermediate: TideMessage[];
  usage?: TideUsageProgress;
  notices?: string[];
}

interface PreparedConversation extends Omit<TideConversationResult,
  'answer' | 'rawContent' | 'toolCalls' | 'turns' | 'intermediate'> {
  runner: SessionRunner;
  systemPrompt: string;
  messages: Parameters<SessionRunner['chat']>[1];
  compaction: TideContextCompaction;
  turnInput: ContextMessage;
}

export class TideConversationFailure extends Error {
  constructor(
    message: string,
    readonly toolCalls: TideRunRecord['toolCalls'],
    readonly turns: number,
    readonly usage?: TideUsageProgress,
    options?: ErrorOptions,
    readonly notices?: string[],
    readonly aborted = false,
  ) {
    super(message, options);
    this.name = 'TideConversationFailure';
  }
}

export async function executeTideConversation(
  dataDir: string,
  task: TideTask,
  onUsage?: (usage: TokenUsage | null, resolved: ResolvedTarget) => Promise<void>,
  onNotice?: (message: string) => Promise<void>,
  onProgress?: (event: CompactionProgress, sessionId: string, revision?: number) => Promise<void>,
  seasonSessions?: SeasonSessionPort,
  signal?: AbortSignal,
  onModelRequest?: (request: ModelRequestUsage, resolved: ResolvedTarget) => Promise<void>,
): Promise<TideConversationResult> {
  signal?.throwIfAborted();
  const prepared = await prepareConversation(dataDir, task, onNotice, onProgress, seasonSessions, signal);
  signal?.throwIfAborted();
  const result = await chatWithTimeout(prepared, onUsage, signal, onModelRequest);
  return { ...prepared, ...result };
}

export async function prepareConversation(dataDir: string, task: TideTask,
  onNotice?: (message: string) => Promise<void>,
  onProgress?: (event: CompactionProgress, sessionId: string, revision?: number) => Promise<void>,
  seasonSessions?: SeasonSessionPort, signal?: AbortSignal): Promise<PreparedConversation> {
  const agent = await loadAgent(dataDir, task.agentId);
  if (!agent) throw new Error(`Agent 不存在: ${task.agentId}`);
  const resolved = await resolveTarget(dataDir, task, seasonSessions);
  const { opts, systemPrompt, rolePrompt } = await buildTideInputContext(dataDir, agent, resolved.sessionId,
    { userMessage: task.prompt, selfLoop: task.selfLoop, signal });
  const userMessage = tideUserMessage(task);
  const turnInput: ContextMessage = { role: 'user', content: userMessage };
  const messages = [
    { role: 'system', content: systemPrompt }, ...resolved.history,
    turnInput,
  ] as Parameters<SessionRunner['chat']>[1];
  const now = new Date().toISOString();
  const compaction = new TideContextCompaction(dataDir, task, resolved,
    { ...(resolved.existing ?? { id: resolved.sessionId, agentId: agent.id, agentName: agent.name,
      title: `🌊 ${task.name}`, messages: [], model: agent.model, systemPrompt: rolePrompt,
      createdAt: now, updatedAt: now }), model: agent.model }, agent.compactionPrompt,
    estimateCompactionTokens([{ role: 'system', content: systemPrompt },
      ...resolved.history.slice(0, resolved.history.at(-1)?.role === 'assistant' ? -1 : undefined)]), onNotice,
    {}, onProgress);
  opts.llmTransform = llm => compaction.transform(llm);
  opts.checkpoint = context => compaction.checkpoint(context);
  return {
    agentName: agent.name, agentModel: agent.model, rolePrompt: agent.rolePrompt,
    resolved, userMessage, runner: new SessionRunner(opts), systemPrompt, messages, compaction, turnInput,
  };
}

async function chatWithTimeout(
  prepared: PreparedConversation,
  onUsage?: (usage: TokenUsage | null, resolved: ResolvedTarget) => Promise<void>,
  signal?: AbortSignal,
  onModelRequest?: (request: ModelRequestUsage, resolved: ResolvedTarget) => Promise<void>,
) {
  const state = createTideEventState(onUsage
    ? usage => onUsage(usage, prepared.resolved) : undefined,
  () => prepared.runner.abort(), onModelRequest ? request => onModelRequest(request, prepared.resolved) : undefined);
  prepared.compaction.flushUsage = () => state.flush();
  const deadline = new TideConversationDeadline(TIMEOUT_MS, () => prepared.runner.abort());
  prepared.compaction.onActivityChanged = active => deadline.setCompacting(active);
  const disposeDeadline = () => deadline.dispose();
  signal?.addEventListener('abort', disposeDeadline, { once: true });
  try {
    const result = await prepared.runner.chat(prepared.systemPrompt, prepared.messages, state.onEvent);
    await state.flush();
    assertTideRunNotTimedOut(deadline.timedOut, TIMEOUT_MS);
    signal?.throwIfAborted();
    prepared.resolved.turnContext = tideGeneratedMediaContext(prepared.messages, prepared.turnInput, state.snapshot().toolContext);
    if (prepared.resolved.compactedContext?.at(-1)?.role !== 'assistant') {
      prepared.resolved.compactedContext?.push({ role: 'assistant', content: result.content });
    }
    return { answer: result.content, rawContent: result.rawContent, ...state.snapshot(),
      ...(prepared.compaction.notices.length ? { notices: prepared.compaction.notices } : {}) };
  } catch (error) {
    let failure = error;
    let persistFailed = false;
    try { await state.flush(); } catch (persistError) { failure = persistError; persistFailed = true; }
    const snapshot = state.snapshot();
    throw new TideConversationFailure(
      failure instanceof Error ? failure.message : String(failure),
      snapshot.toolCalls,
      snapshot.turns,
      snapshot.usage,
      { cause: failure },
      prepared.compaction.notices,
      !!signal?.aborted && !persistFailed && !deadline.timedOut,
    );
  } finally {
    prepared.compaction.onActivityChanged = undefined;
    signal?.removeEventListener('abort', disposeDeadline);
    deadline.dispose();
  }
}

function tideUserMessage(task: TideTask): string {
  if (!task.selfLoop || !task.originalPrompt || task.prompt === task.originalPrompt) return task.prompt;
  return `## 最高目标（每轮必须围绕此目标行动）\n${task.originalPrompt}\n\n## 本轮具体任务\n${task.prompt}`;
}
