import { callLLM } from './llm-bridge.js';
import type { LoadedAgent } from './agent-loader.js';
import type { ToolDef } from './tool-defs-loader.js';
import type { SandboxLevel } from './sandbox-prompt.js';
import type { ContextMessage } from './types.js';
import {
  runReActLoopNative,
  type LLMCaller,
  type ToolCaller,
} from '../conversation/react-loop.js';

export interface NativeSubAgentResult {
  status: 'success' | 'timeout' | 'aborted' | 'error';
  summary: string;
  rounds: number;
  error?: string;
}

export type NativeSubAgentEvent =
  | { type: 'token'; data: { t: string } }
  | { type: 'reasoning'; data: { t: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, string> } }
  | { type: 'tool_result'; data: { tool: string; result: string; ok: boolean } }
  | { type: 'done'; data: NativeSubAgentResult };

export interface NativeSubAgentParams {
  agent: LoadedAgent;
  model: string;
  tools: ToolDef[];
  systemPrompt: string;
  task: string;
  context: string;
  dataDir: string;
  sandboxSection: string;
  escalationNote: string;
  constraintsSection: string;
  maxRounds: number;
  signal: AbortSignal;
  emitEvent: (event: NativeSubAgentEvent) => void;
  parentSandboxLevel: SandboxLevel;
}

interface LoopResult { content: string; turns: number }
interface AbortLink { signal: AbortSignal; dispose: () => void }
interface Runtime {
  params: NativeSubAgentParams;
  messages: ContextMessage[];
  doneSummary?: string;
  toolRounds: number;
  doneController: AbortController;
  mainAbort: AbortLink;
  toolCaller: ToolCaller;
  llm: LLMCaller;
}

function buildNativeProtocol(tools: ToolDef[]): string {
  const list = tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');
  return `## 工作方式

你可以调用工具完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你。

- 需要外部信息或执行操作时，调用对应工具
- 串行依赖请分多轮调用
- **任务完成时必须调用 \`done\` 工具提交结果**，summary 字段填写完整结果
- 调用 done 后 SubAgent 立即终止，不要在 done 之前输出最终结论

## 可用工具

${list}`;
}

function linkAbortSignals(...signals: AbortSignal[]): AbortLink {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort);
  }
  return {
    signal: controller.signal,
    dispose: () => signals.forEach(signal => signal.removeEventListener('abort', abort)),
  };
}

function createMessages(params: NativeSubAgentParams): ContextMessage[] {
  const system = [
    params.systemPrompt,
    buildNativeProtocol(params.tools),
    params.sandboxSection,
    params.escalationNote,
    params.constraintsSection,
  ].join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `任务：${params.task}\n\n背景：${params.context}` },
  ];
}

async function executeRuntimeTool(
  runtime: Runtime,
  tool: string,
  args: Record<string, string>,
): Promise<string> {
  if (tool === 'done') {
    runtime.doneSummary = args.summary || '';
    runtime.doneController.abort();
    return '已收到完成信号';
  }
  if (tool === 'delegate') return '错误：SubAgent 不可调用 delegate。';

  runtime.toolRounds++;
  runtime.params.emitEvent({ type: 'tool_call', data: { tool, args } });
  try {
    const { executeTool } = await import('../../services/tool-executor.js');
    const result = await executeTool(
      runtime.params.dataDir, tool, args, runtime.params.agent.id, undefined,
      runtime.params.parentSandboxLevel, undefined, runtime.mainAbort.signal,
    );
    runtime.params.emitEvent({ type: 'tool_result', data: { tool, result, ok: true } });
    return result;
  } catch (cause) {
    const result = (cause as Error)?.message ?? String(cause);
    runtime.params.emitEvent({ type: 'tool_result', data: { tool, result, ok: false } });
    return `工具执行失败：${result}`;
  }
}

function createRuntime(params: NativeSubAgentParams): Runtime {
  const doneController = new AbortController();
  const mainAbort = linkAbortSignals(params.signal, doneController.signal);
  const runtime = {
    params,
    messages: createMessages(params),
    toolRounds: 0,
    doneController,
    mainAbort,
  } as Runtime;
  runtime.toolCaller = { call: (tool, args) => executeRuntimeTool(runtime, tool, args) };
  runtime.llm = {
    call: (messages, _options, onChunk, signal, tools) => callLLM({
      dataDir: params.dataDir,
      fullModelKey: params.model,
      messages,
      options: { temperature: params.agent.temperature },
      onChunk,
      signal,
      tools,
    }),
  };
  return runtime;
}

function emitLoopEvent(runtime: Runtime, event: { type: string; chunk?: string }): void {
  if (event.type === 'token') {
    runtime.params.emitEvent({ type: 'token', data: { t: event.chunk ?? '' } });
  } else if (event.type === 'reasoning') {
    runtime.params.emitEvent({ type: 'reasoning', data: { t: event.chunk ?? '' } });
  }
}

async function runLoop(runtime: Runtime, maxTurns: number, signal: AbortSignal): Promise<LoopResult> {
  const result = await runReActLoopNative({
    messages: runtime.messages,
    llm: runtime.llm,
    tools: runtime.toolCaller,
    toolDefs: runtime.params.tools,
    maxTurns,
    signal,
    onEvent: event => emitLoopEvent(runtime, event),
  });
  return { content: result.content, turns: result.turns };
}

function finish(runtime: Runtime, result: NativeSubAgentResult): NativeSubAgentResult {
  runtime.params.emitEvent({ type: 'done', data: result });
  return result;
}

function success(runtime: Runtime): NativeSubAgentResult {
  return finish(runtime, {
    status: 'success',
    summary: runtime.doneSummary ?? '',
    rounds: runtime.toolRounds,
  });
}

async function remindDone(runtime: Runtime): Promise<void> {
  runtime.messages.push({ role: 'user', content: '请调用 done 工具提交你的结果。' });
  if (runtime.params.signal.aborted) return;
  try {
    await runLoop(runtime, 5, runtime.mainAbort.signal);
  } catch (cause) {
    if (!runtime.doneSummary && !runtime.params.signal.aborted) throw cause;
  }
}

async function runFallback(runtime: Runtime, main: LoopResult): Promise<NativeSubAgentResult> {
  runtime.messages.push({
    role: 'system',
    content: '轮次已耗尽。立即调用 done 汇报已完成的工作，不要再调用其他工具。',
  });
  const fallbackAbort = linkAbortSignals(runtime.params.signal, runtime.doneController.signal);
  let retry: LoopResult = { content: '', turns: 0 };
  try {
    retry = await runLoop(runtime, 3, fallbackAbort.signal);
  } catch (cause) {
    if (!runtime.doneSummary && !runtime.params.signal.aborted) throw cause;
  } finally {
    fallbackAbort.dispose();
  }

  const rounds = runtime.params.maxRounds + retry.turns;
  if (runtime.doneSummary !== undefined) {
    return finish(runtime, { status: 'timeout', summary: runtime.doneSummary, rounds });
  }
  if (runtime.params.signal.aborted) {
    return finish(runtime, { status: 'aborted', summary: 'SubAgent 被外部中止', rounds });
  }
  const summary = (retry.content || main.content).trim();
  return finish(runtime, summary.length > 20
    ? { status: 'timeout', summary, rounds }
    : { status: 'timeout', summary: 'SubAgent 未能在规定轮次内完成', rounds });
}

async function finishAfterMain(runtime: Runtime, main: LoopResult): Promise<NativeSubAgentResult> {
  if (runtime.doneSummary !== undefined) return success(runtime);
  if (runtime.params.signal.aborted) {
    return finish(runtime, {
      status: 'aborted', summary: 'SubAgent 被外部中止', rounds: runtime.toolRounds,
    });
  }
  await remindDone(runtime);
  if (runtime.doneSummary !== undefined) return success(runtime);
  return runFallback(runtime, main);
}

export async function runNativeSubAgent(
  params: NativeSubAgentParams,
): Promise<NativeSubAgentResult> {
  const runtime = createRuntime(params);
  try {
    const main = await runLoop(runtime, params.maxRounds, runtime.mainAbort.signal);
    return await finishAfterMain(runtime, main);
  } finally {
    runtime.mainAbort.dispose();
  }
}
