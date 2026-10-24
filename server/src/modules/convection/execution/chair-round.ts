import { withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { callLLM, type TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { saveSession, type ConvectionSessionData } from '../infrastructure/session-store.js';
import { loadRequiredAgent } from './round-agent-snapshot.js';
import { recordChairUsage } from './session-view.js';
import type { ConvectionEventSink } from './stream-events.js';
import { createConvectionCompactionCaller } from './compaction-caller.js';
import type { LLMCaller } from '../../../engine/shared/react/native-loop.js';
import { finishConvectionChairContext } from './chair-context.js';
import { buildConvectionChairMessages } from './request-context.js';
import { estimateCompactionTokens } from '../../../engine/shared/compaction/index.js';
import { withConvectionModelUsage } from './model-usage.js';
import { callPreparedModel } from '../../../engine/shared/react/model-call.js';

const LLM_TIMEOUT_MS = 3_600_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

export async function handleChair(
  dataDir: string,
  session: ConvectionSessionData,
  humanMessage: string,
  emit?: ConvectionEventSink,
  signal?: AbortSignal,
  runId?: string,
): Promise<void> {
  const previousPromptTokens = session.chairTokenUsage?.promptTokens;
  session.chairCompactionNotice = undefined;
  session.chairCompactionProgress = undefined;
  session.chairMessages.push({ role: 'user', content: humanMessage,
    ...(runId ? { runId } : {}) });
  recordChairUsage(session, null);
  await saveSession(dataDir, session);
  emit?.({ type: 'input-accepted' });
  emit?.({ type: 'usage', usage: null });
  const agent = await loadRequiredAgent(dataDir, session.chairAgentId);
  emit?.({ type: 'agent-start', agentId: agent.id, label: agent.name });
  const messages = buildConvectionChairMessages(session, agent.name);
  const response = await withConvectionModelUsage(dataDir, session, 'chair', emit, observed => requestChairReply({
    dataDir, agentId: agent.id, label: agent.name, model: agent.model,
    messages,
    emit: observed, signal,
    llm: createConvectionCompactionCaller({ dataDir, session,
      agent, chair: agent, messages, kind: 'chair', emit, initialPromptTokens: previousPromptTokens }),
  }));
  if (!response) return;
  await applyChairReply(session, response, () => saveSession(dataDir, session), emit, runId, messages);
}

/** 模型已返回时先保存真实用量，再校验正文并报告终态。 */
export async function applyChairReply(
  session: ConvectionSessionData,
  response: { content: string; usage?: TokenUsage },
  save: () => Promise<void>,
  emit?: ConvectionEventSink,
  runId?: string,
  messages?: ContextMessage[],
): Promise<void> {
  recordChairUsage(session, response.usage);
  if (messages) session.chairRequestEstimate = estimateCompactionTokens(messages);
  if (response.content) session.chairMessages.push({ role: 'assistant', content: response.content,
    ...(runId ? { runId } : {}) });
  if (response.content && messages) finishConvectionChairContext(session, messages,
    { role: 'assistant', content: response.content });
  await save();
  emit?.({ type: 'usage', usage: session.chairTokenUsage ?? null });
  if (!response.content) throw chairError('MODEL_EMPTY_RESPONSE', 'protocol', '模型返回空响应');
  emit?.({ type: 'chair-done', content: response.content });
}

interface ChairRequest {
  dataDir: string;
  agentId: string;
  label: string;
  model: string;
  messages: ContextMessage[];
  emit?: ConvectionEventSink;
  signal?: AbortSignal;
  llm?: LLMCaller;
}

async function requestChairReply(
  request: ChairRequest,
): Promise<{ content: string; usage?: TokenUsage } | null> {
  const abort = new AbortController();
  let timedOut = false;
  let tokenReceived = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, LLM_TIMEOUT_MS);
  const onAbort = () => abort.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });
  const heartbeat = startChairHeartbeat(request, startedAt, () => tokenReceived);
  try {
    const llm = request.llm ?? { call: (messages, _options, onChunk, signal, _tools, onReasoning) => callLLM({
      dataDir: request.dataDir, fullModelKey: request.model, messages, onChunk, onReasoning, signal,
    }) } satisfies LLMCaller;
    const response = await withAgentActivity(request.agentId, 'convection', () => callPreparedModel(llm,
      request.messages, abort.signal, {
        onChunk: chunk => { tokenReceived = true; request.emit?.({ type: 'chair-token', chunk }); },
        onReasoning: chunk => { tokenReceived = true; request.emit?.({ type: 'chair-reasoning', chunk }); },
        onEvent: event => { if (event.type === 'model-request') request.emit?.(event); },
      }));
    const content = response.content.trim();
    return { content, usage: response.usage };
  } catch (error) {
    if (request.signal?.aborted) return null;
    throw normalizeChairError(error, timedOut);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}

function startChairHeartbeat(
  request: ChairRequest,
  startedAt: number,
  received: () => boolean,
): NodeJS.Timeout | undefined {
  if (!request.emit) return undefined;
  return setInterval(() => {
    if (!received()) request.emit?.({ type: 'heartbeat', agentId: request.agentId,
      label: request.label, phase: 'llm-waiting', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS);
}

function normalizeChairError(error: unknown, timedOut: boolean): unknown {
  if (timedOut) return chairError('MODEL_TIMEOUT', 'timeout',
    `会议助理响应超时（${LLM_TIMEOUT_MS / 1000}s）`, error);
  if (error instanceof FrameworkError) return error;
  return chairError('MODEL_REQUEST_FAILED', 'provider', '模型请求失败', error);
}

function chairError(
  code: string,
  kind: 'protocol' | 'timeout' | 'provider',
  message: string,
  cause?: unknown,
): FrameworkError {
  return new FrameworkError({ code, kind, message, source: 'convection.chair', retryable: false },
    cause === undefined ? undefined : { cause });
}
