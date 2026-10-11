import type { ContextMessage } from '../shared/types.js';
import {
  runReActLoopNative, SuspendSignal, type LLMCaller, type ReActLoopResult,
  type ReActStreamEvent, type ToolCaller,
} from '../shared/react/native-loop.js';
import { runReActLoop } from '../shared/react/text-loop.js';
import { callLLM } from '../shared/llm-bridge.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { shouldAttachToolCaller } from './virtual-tools.js';
import { resolveConversationTermination } from './conversation-outcome.js';
import type { ConversationInputRuntime } from './input-runtime.js';
import { FileChangeLedger } from './file-change-ledger.js';
import { createSessionToolCaller } from './session-tool-dispatcher.js';
import { loadSessionToolSets } from './session-tool-assembly.js';
import type { ConversationEvent, SessionRunnerOpts } from './session-runner-contracts.js';
import type { ToolRegistrationProposal } from '../shared/tool-registration.js';
import type { TeamHandoff } from './team/handoff.js';

interface SessionLoopInput {
  options: SessionRunnerOpts;
  systemPrompt: string;
  messages: ContextMessage[];
  inputRuntime: ConversationInputRuntime | null;
  signal: AbortSignal;
  emit(event: ConversationEvent): void;
  setPendingRegistration(proposal: ToolRegistrationProposal): void;
  suspend(state: {
    messages: ContextMessage[];
    systemPrompt: string;
    pendingToolCallId?: string;
  }): void;
}

interface PreparedLoop {
  toolDefs: ToolDef[];
  toolCaller: ToolCaller;
  llm: LLMCaller;
  beforeFinish?: () => Promise<string[]>;
  enableTools: boolean;
}

export async function executeSessionLoop(
  input: SessionLoopInput,
): Promise<{ content: string; rawContent: string }> {
  let generatedContextStart = input.messages.length;
  const prepared = await prepareLoop(input, next => {
    generatedContextStart = next.length;
    input.inputRuntime?.rebase(next.length);
  });
  const result = input.options.native
    ? await executeNative(input, prepared)
    : await executeText(input, prepared);
  return finishLoop(input, result, generatedContextStart);
}

async function prepareLoop(input: SessionLoopInput,
  rebase: (next: ContextMessage[]) => void): Promise<PreparedLoop> {
  const opts = input.options;
  const toolSets = await loadSessionToolSets(opts);
  const toolDefs = toolSets.runtime;
  const handoff = opts.extension?.createHandoff?.();
  const beforeFinish = handoff ? () => handoff.beforeFinish(
    input.signal,
    () => input.inputRuntime?.steering.hasPending() ?? false,
    () => input.emit({ type: 'heartbeat', phase: 'tool-exec', elapsed: 0 }),
  ) : undefined;
  const toolCaller = createSessionToolCaller({
    dataDir: opts.dataDir, agentId: opts.agentId, model: opts.model,
    workspace: opts.workspace, sandboxLevel: opts.sandboxLevel,
    sessionId: opts.sessionId, mainAgent: opts.mainAgent,
    allowAsk: opts.allowAsk, allowDelegate: opts.allowDelegate,
    memberTools: opts.memberTools, extension: opts.extension,
    interceptTool: opts.interceptTool, signal: input.signal,
    guideToolDefs: toolSets.guide, ledger: new FileChangeLedger(), emit: input.emit,
    setPendingRegistration: input.setPendingRegistration,
  });
  return {
    toolDefs, toolCaller, beforeFinish,
    llm: createLlmCaller(input, handoff, rebase),
    enableTools: shouldAttachToolCaller(toolDefs, !!opts.interceptTool),
  };
}

function createLlmCaller(
  input: SessionLoopInput,
  handoff: TeamHandoff | undefined,
  rebase: (next: ContextMessage[]) => void,
): LLMCaller {
  const opts = input.options;
  const base: LLMCaller = { call: (messages, _options, onChunk, signal, tools, onReasoning, onToolProgress) =>
    callLLM({ dataDir: opts.dataDir, fullModelKey: opts.model, messages,
      options: { temperature: opts.temperature }, onChunk, signal, tools, onReasoning, onToolProgress }) };
  const caller = opts.llmTransform?.(base, input.emit, rebase) ?? base;
  return { async call(msgs, _options, onChunk, signal, tools, onReasoning, onToolProgress) {
    if (!signal?.aborted && handoff) {
      const notices = await handoff.notifications();
      msgs.push(...notices.map(content => ({ role: 'user' as const, content })));
    }
    await opts.checkpoint?.(msgs);
    await input.inputRuntime?.beforeModel();
    if (input.inputRuntime && signal?.aborted) throw new Error('Conversation aborted');
    return caller.call(msgs, _options, onChunk, signal, tools, onReasoning, onToolProgress);
  } };
}

function executeNative(input: SessionLoopInput, prepared: PreparedLoop): Promise<ReActLoopResult> {
  return runReActLoopNative({
    retainFinalContext: !!input.options.checkpoint,
    beforeFinish: prepared.beforeFinish,
    maxTurns: input.options.maxTurns,
    steering: input.inputRuntime?.steering,
    messages: input.messages,
    llm: prepared.llm,
    tools: prepared.enableTools ? prepared.toolCaller : undefined,
    toolDefs: prepared.toolDefs,
    onEvent: event => emitNativeEvent(input.emit, event),
    onToolError: error => error instanceof SuspendSignal
      ? { reason: 'ask', question: error.question, options: error.options } : null,
    signal: input.signal,
  });
}

function executeText(input: SessionLoopInput, prepared: PreparedLoop): Promise<ReActLoopResult> {
  return runReActLoop({
    beforeFinish: prepared.beforeFinish,
    maxTurns: input.options.maxTurns,
    steering: input.inputRuntime?.steering,
    messages: input.messages,
    llm: prepared.llm,
    tools: prepared.enableTools ? prepared.toolCaller : undefined,
    allowedTools: prepared.toolDefs.map(tool => tool.name),
    onEvent: event => emitTextEvent(input.emit, event),
    signal: input.signal,
  });
}

function finishLoop(
  input: SessionLoopInput, result: ReActLoopResult, generatedContextStart: number,
): { content: string; rawContent: string } {
  if (result.suspended) {
    input.suspend({
      messages: input.messages, systemPrompt: input.systemPrompt,
      pendingToolCallId: result.suspended.pendingToolCallId,
    });
    input.emit({ type: 'ask', question: result.suspended.question,
      options: result.suspended.options });
    input.emit({ type: 'done' });
    return { content: '', rawContent: '' };
  }
  if (resolveConversationTermination(result.termination) === 'aborted') {
    input.emit({ type: 'done' });
    return { content: '', rawContent: '' };
  }
  input.emit({
    type: 'answer', content: result.content, rawContent: result.rawContent,
    native: !!input.options.native,
    nativeContext: input.options.native
      ? input.messages.slice(generatedContextStart) : undefined,
  });
  input.emit({ type: 'done' });
  return { content: result.content, rawContent: result.rawContent };
}

function emitNativeEvent(emit: SessionLoopInput['emit'], event: ReActStreamEvent): void {
  if (event.type === 'token') emit({ type: 'token', content: event.chunk });
  else if (event.type === 'reasoning') emit({ type: 'reasoning', content: event.chunk });
  else if (event.type === 'tool-progress' || event.type === 'heartbeat' || event.type === 'usage') emit(event);
}

function emitTextEvent(emit: SessionLoopInput['emit'], event: ReActStreamEvent): void {
  if (event.type === 'token') emit({ type: 'token', content: event.chunk });
  else if (event.type === 'reasoning') emit({ type: 'reasoning', content: event.chunk });
  else if (event.type === 'heartbeat' || event.type === 'usage') emit(event);
}
