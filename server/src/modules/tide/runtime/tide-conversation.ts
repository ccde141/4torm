import path from 'node:path';
import { buildConversationSystemPrompt } from '../../../engine/conversation/prompt-builder.js';
import { loadSessionToolSets } from '../../../engine/conversation/session-tool-assembly.js';
import { SessionRunner, type SessionRunnerOpts } from '../../../engine/conversation/session-runner.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { estimateCompactionTokens } from '../../../engine/shared/compaction/index.js';
import { SELF_LOOP_INSTRUCTION } from '../domain/self-loop.js';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import { TIDE_META } from '../domain/meta.js';
import { resolveTarget, type ResolvedTarget } from '../sessions/session-resolver.js';
import type { TideMessage } from '../sessions/session-types.js';
import type { TideUsageProgress } from '../domain/token-usage.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { assertTideRunNotTimedOut } from './run-outcome.js';
import { createTideEventState } from './tide-conversation-events.js';
import { TideContextCompaction } from './context-compaction.js';

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
}

export class TideConversationFailure extends Error {
  constructor(
    message: string,
    readonly toolCalls: TideRunRecord['toolCalls'],
    readonly turns: number,
    readonly usage?: TideUsageProgress,
    options?: ErrorOptions,
    readonly notices?: string[],
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
): Promise<TideConversationResult> {
  const prepared = await prepareConversation(dataDir, task, onNotice);
  const result = await chatWithTimeout(prepared, onUsage);
  return { ...prepared, ...result };
}

export async function prepareConversation(dataDir: string, task: TideTask,
  onNotice?: (message: string) => Promise<void>): Promise<PreparedConversation> {
  const agent = await loadAgent(dataDir, task.agentId);
  if (!agent) throw new Error(`Agent 不存在: ${task.agentId}`);
  const resolved = await resolveTarget(dataDir, task);
  const nativeDecision = await resolveNativeMode(dataDir, agent.model);
  const opts: SessionRunnerOpts = {
    dataDir, agentId: agent.id, model: agent.model, temperature: agent.temperature,
    toolNames: agent.tools, toolMode: agent.toolMode, skillIds: agent.skills,
    workspace: agent.workspace, sandboxLevel: agent.sandboxLevel,
    native: nativeDecision.native, allowAsk: false, allowDelegate: false,
  };
  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, agent.workspace);
  const toolDefs = (await loadSessionToolSets(opts)).guide;
  const rolePrompt = task.selfLoop ? agent.rolePrompt + SELF_LOOP_INSTRUCTION : agent.rolePrompt;
  const systemPrompt = await buildConversationSystemPrompt({
    rolePrompt, toolDefs, workspace: opts.workspace, workspaceAbs, projectDir,
    sandboxLevel: agent.sandboxLevel, skillIds: opts.skillIds, dataDir, agentId: agent.id,
    userMessage: task.prompt, native: nativeDecision.native, allowAsk: false,
    allowDelegate: false, surfaceMeta: TIDE_META,
  });
  const userMessage = tideUserMessage(task);
  const messages = [
    { role: 'system', content: systemPrompt }, ...resolved.history,
    { role: 'user', content: userMessage },
  ] as Parameters<SessionRunner['chat']>[1];
  const now = new Date().toISOString();
  const compaction = new TideContextCompaction(dataDir, task, resolved,
    { ...(resolved.existing ?? { id: resolved.sessionId, agentId: agent.id, agentName: agent.name,
      title: `🌊 ${task.name}`, messages: [], model: agent.model, systemPrompt: rolePrompt,
      createdAt: now, updatedAt: now }), model: agent.model }, agent.compactionPrompt,
    estimateCompactionTokens([{ role: 'system', content: systemPrompt },
      ...resolved.history.slice(0, resolved.history.at(-1)?.role === 'assistant' ? -1 : undefined)]), onNotice);
  opts.llmTransform = llm => compaction.transform(llm);
  opts.checkpoint = context => compaction.checkpoint(context);
  return {
    agentName: agent.name, agentModel: agent.model, rolePrompt: agent.rolePrompt,
    resolved, userMessage, runner: new SessionRunner(opts), systemPrompt, messages, compaction,
  };
}

async function chatWithTimeout(
  prepared: PreparedConversation,
  onUsage?: (usage: TokenUsage | null, resolved: ResolvedTarget) => Promise<void>,
) {
  const state = createTideEventState(onUsage
    ? usage => onUsage(usage, prepared.resolved) : undefined,
  () => prepared.runner.abort());
  prepared.compaction.flushUsage = () => state.flush();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    prepared.runner.abort();
  }, TIMEOUT_MS);
  try {
    const result = await prepared.runner.chat(prepared.systemPrompt, prepared.messages, state.onEvent);
    await state.flush();
    assertTideRunNotTimedOut(timedOut, TIMEOUT_MS);
    if (prepared.resolved.compactedContext?.at(-1)?.role !== 'assistant') {
      prepared.resolved.compactedContext?.push({ role: 'assistant', content: result.content });
    }
    return { answer: result.content, rawContent: result.rawContent, ...state.snapshot(),
      ...(prepared.compaction.notices.length ? { notices: prepared.compaction.notices } : {}) };
  } catch (error) {
    try { await state.flush(); } catch (persistError) { error = persistError; }
    const snapshot = state.snapshot();
    throw new TideConversationFailure(
      error instanceof Error ? error.message : String(error),
      snapshot.toolCalls,
      snapshot.turns,
      snapshot.usage,
      { cause: error },
      prepared.compaction.notices,
    );
  } finally {
    clearTimeout(timer);
  }
}

function tideUserMessage(task: TideTask): string {
  if (!task.selfLoop || !task.originalPrompt || task.prompt === task.originalPrompt) return task.prompt;
  return `## 最高目标（每轮必须围绕此目标行动）\n${task.originalPrompt}\n\n## 本轮具体任务\n${task.prompt}`;
}
