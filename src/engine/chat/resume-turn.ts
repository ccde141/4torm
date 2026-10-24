import type { ChatSession } from '../../store/chat';
import { TitleCompletion } from '../../store/session-naming';
import type { Agent, ChatMessage } from '../../types';
import type { TaskBoard } from '../../utils/taskboard';
import { streamUrl } from '../../lib/apiBase';
import { MonsoonMessageProjection } from './monsoon-projection';
import { reconcileMonsoonInterruption } from './run-reconciliation';
import { readMonsoonEvents, type MonsoonBrowserEvent } from './sse-events';
import { retainStopped } from './stream-retention';
import { StreamTerminal } from './stream-terminal';
import { findLatestAnswerableAsk } from './pending-ask';

export interface ResumeTurnInput {
  sessionId: string;
  agent: Agent;
  model: string;
  askMessageId: string;
  waitingRunId: string;
  answer: string;
}

export interface ResumeTurnPorts {
  request: typeof fetch;
  loadSession(sessionId: string): Promise<ChatSession | null>;
  begin(abort: () => void, messages: ChatMessage[]): void;
  emit(messages: ChatMessage[]): void;
  bufferedMessages(): ChatMessage[] | undefined;
  isAbandoned(): boolean;
  saveSession(session: ChatSession): Promise<ChatSession>;
  refreshSessions(agent: Agent): void;
  applyTaskboard(board: TaskBoard | null): void;
  generateMessageId(): string;
  nameSession(sessionId: string): Promise<void>;
  errorMessage(detail: string): string;
  saveFailureMessage(detail: string): string;
  persistenceError(detail: string): void;
  syncLatest?(messages: ChatMessage[]): void;
  accepted?(): void;
  rejected?(detail: string): void;
  uncertain?(detail: string): void;
  finalize(completed: boolean): void;
  onCompaction?(event: MonsoonBrowserEvent): void;
}

interface ResumeState {
  session: ChatSession;
  controller: AbortController;
  assistantId: string;
  answered: ChatMessage[];
  messages: ChatMessage[];
  projection: MonsoonMessageProjection;
  terminal: StreamTerminal;
  title: TitleCompletion;
  flusher: EventFlusher;
  accepted: boolean;
  completeStream: boolean;
}

class ReplyRejectedError extends Error {}
interface EventFlusher {
  update(messages: ChatMessage[], immediate: boolean): void;
  close(messages: ChatMessage[]): void;
}
export async function resumeMonsoonTurn(
  input: ResumeTurnInput,
  ports: ResumeTurnPorts,
): Promise<void> {
  const session = await ports.loadSession(input.sessionId);
  if (!session) {
    ports.persistenceError('会话不存在或已删除');
    ports.rejected?.('会话不存在或已删除');
    return;
  }
  const ask = findLatestAnswerableAsk(session.messages);
  if (session.agentId !== input.agent.id || ask?.id !== input.askMessageId
    || ask.runId !== input.waitingRunId) {
    ports.syncLatest?.(session.messages);
    ports.rejected?.('目标提问已更新，请查看当前会话');
    return;
  }
  const state = startTurn(input, session, ports);
  try {
    const response = await requestReply(input, state, ports.request);
    await consumeReply(input, response, state, ports);
    await persistCompleted(input, state, ports);
  } catch (error) {
    await handleFailure(error, input, state, ports);
  } finally {
    await finishTurn(input, state, ports);
  }
}
function startTurn(input: ResumeTurnInput, session: ChatSession, ports: ResumeTurnPorts): ResumeState {
  const answered = session.messages.map(message => message.id === input.askMessageId && message.ask
    ? { ...message, ask: { ...message.ask, reply: input.answer } } : message);
  const controller = new AbortController();
  ports.begin(() => controller.abort(), answered);
  const assistantId = ports.generateMessageId();
  const placeholder: ChatMessage = {
    id: assistantId, inputRunId: assistantId, role: 'assistant', content: '',
    runCommitted: false,
    timestamp: new Date().toISOString(), agentId: input.agent.id,
    streamingPhase: 'llm-waiting', phaseElapsed: 0,
  };
  const messages = [...answered, placeholder];
  ports.emit(messages);
  return {
    session, controller, assistantId, answered, messages,
    projection: new MonsoonMessageProjection(messages, assistantId, input.agent.id,
      ports.generateMessageId),
    terminal: new StreamTerminal(), title: new TitleCompletion(),
    flusher: createEventFlusher(ports.emit),
    accepted: false, completeStream: false,
  };
}
function acceptReply(input: ResumeTurnInput, state: ResumeState, ports: ResumeTurnPorts): void {
  state.accepted = true;
  state.answered = markAskAnswered(state.answered, input.askMessageId, input.answer);
  state.messages = markAskAnswered(state.messages, input.askMessageId, input.answer);
  state.projection = new MonsoonMessageProjection(state.messages, state.assistantId,
    input.agent.id, ports.generateMessageId);
  state.projection.acceptHumanInput();
  state.messages = state.projection.messages;
  ports.emit(state.messages);
  ports.accepted?.();
}
async function requestReply(
  input: ResumeTurnInput,
  state: ResumeState,
  request: typeof fetch,
): Promise<Response> {
  const response = await request(streamUrl('/api/conversation/reply'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId, answer: input.answer, inputRunId: state.assistantId,
      expectedWaitingRunId: input.waitingRunId,
    }),
    signal: state.controller.signal,
  });
  if (!response.ok) throw new ReplyRejectedError(await response.text().catch(() => '未知错误'));
  return response;
}

async function consumeReply(
  input: ResumeTurnInput,
  response: Response,
  state: ResumeState,
  ports: ResumeTurnPorts,
): Promise<void> {
  for await (const event of readMonsoonEvents(response.body)) {
    ports.onCompaction?.(event);
    if (event.type === 'reply-accepted') {
      if (state.accepted || event.waitingRunId !== input.waitingRunId
        || event.answer !== input.answer) throw new Error('季风回复确认与当前提问不匹配');
      acceptReply(input, state, ports);
      continue;
    }
    state.title.observe(event.type);
    state.terminal.observe(event.type);
    if (event.type === 'error') {
      const detail = String(event.message || '执行失败');
      if (!state.accepted) throw new ReplyRejectedError(detail);
      throw new Error(detail);
    }
    const effect = state.projection.apply(event);
    if (effect.revision !== undefined) state.session.revision = effect.revision;
    state.messages = state.projection.messages;
    if (Object.hasOwn(effect, 'taskboard')) ports.applyTaskboard(effect.taskboard ?? null);
    if (Object.hasOwn(effect, 'usage')) {
      if (effect.usage) state.session.tokenUsage = effect.usage;
      else delete state.session.tokenUsage;
      ports.refreshSessions(input.agent);
    }
    if (event.type === 'model-request') ports.refreshSessions(input.agent);
    if (effect.flush) state.flusher.update(state.messages, effect.flush === 'immediate');
  }
  if (!state.accepted) throw new Error('未收到季风回复接收确认');
  state.terminal.assertClosed(state.controller.signal.aborted);
  state.completeStream = !state.controller.signal.aborted;
  state.flusher.close(state.messages);
}

async function persistCompleted(
  input: ResumeTurnInput,
  state: ResumeState,
  ports: ResumeTurnPorts,
): Promise<void> {
  if (ports.isAbandoned()) return;
  try {
    state.session = await ports.saveSession(withMessages(state, state.messages, input.model));
    ports.refreshSessions(input.agent);
    if (state.title.ready(state.controller.signal.aborted)) scheduleNaming(input, ports);
  } catch (error) {
    state.title.observe('error');
    const message = assistantMessage(input.agent.id, ports.generateMessageId(),
      ports.saveFailureMessage(errorText(error)));
    ports.emit([...state.messages, message]);
    ports.persistenceError(errorText(error));
  }
}

async function handleFailure(
  error: unknown,
  input: ResumeTurnInput,
  state: ResumeState,
  ports: ResumeTurnPorts,
): Promise<void> {
  state.title.observe('error');
  state.flusher.close(state.messages);
  if (state.controller.signal.aborted && !state.accepted) {
    state.messages = state.session.messages;
    ports.emit(state.messages);
    return;
  }
  if (error instanceof ReplyRejectedError) {
    const latest = await ports.loadSession(input.sessionId).catch(() => null);
    state.messages = latest?.messages ?? state.session.messages;
    ports.emit(state.messages);
    ports.syncLatest?.(state.messages);
    ports.rejected?.(error.message);
    return;
  }
  if (!state.accepted) {
    state.messages = state.session.messages;
    ports.emit(state.messages);
    const detail = await reconcileMonsoonInterruption(
      input.sessionId, state.assistantId, errorText(error), ports.request);
    ports.uncertain?.(detail);
    return;
  }
  const detail = await reconcileMonsoonInterruption(
    input.sessionId, state.assistantId, errorText(error), ports.request,
  );
  const buffered = ports.bufferedMessages() ?? state.answered;
  const message = assistantMessage(input.agent.id, ports.generateMessageId(),
    ports.errorMessage(detail));
  state.messages = [...buffered, message];
  ports.emit(state.messages);
  if (ports.isAbandoned()) return;
  try { state.session = await ports.saveSession(withMessages(state, state.messages, input.model)); }
  catch (saveError) { ports.persistenceError(errorText(saveError)); }
}

async function finishTurn(
  input: ResumeTurnInput,
  state: ResumeState,
  ports: ResumeTurnPorts,
): Promise<void> {
  if (state.controller.signal.aborted && !ports.isAbandoned()) {
    if (!state.accepted) { ports.finalize(false); return; }
    state.messages = retainStopped(state.messages, state.assistantId);
    ports.emit(state.messages);
    try { state.session = await ports.saveSession(withMessages(state, state.messages, input.model)); }
    catch (error) { ports.persistenceError(errorText(error)); }
  }
  ports.finalize(state.title.ready(state.controller.signal.aborted));
}

function markAskAnswered(messages: ChatMessage[], id: string, answer: string): ChatMessage[] {
  return messages.map(message => message.id === id && message.ask
    ? { ...message, ask: { ...message.ask, answered: true, reply: answer } }
    : message);
}

function createEventFlusher(emit: (messages: ChatMessage[]) => void): EventFlusher {
  let lastFlushAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ChatMessage[] = [];
  const flush = () => {
    timer = undefined;
    lastFlushAt = Date.now();
    emit([...pending]);
  };
  return {
    update(messages, immediate) {
      pending = messages;
      if (immediate) { if (timer) clearTimeout(timer); flush(); return; }
      if (timer) return;
      const wait = 80 - (Date.now() - lastFlushAt);
      if (wait <= 0) flush(); else timer = setTimeout(flush, wait);
    },
    close(messages) {
      pending = messages;
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

function withMessages(state: ResumeState, messages: ChatMessage[], model?: string): ChatSession {
  const finalized = messages.map(message => message.id === state.assistantId
    ? { ...message, runCommitted: state.completeStream } : message);
  return { ...state.session, messages: finalized, ...(model ? { model } : {}) };
}

function assistantMessage(agentId: string, id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, timestamp: new Date().toISOString(), agentId };
}

function scheduleNaming(input: ResumeTurnInput, ports: ResumeTurnPorts): void {
  void ports.nameSession(input.sessionId).then(() => ports.refreshSessions(input.agent))
    .catch(error => ports.persistenceError(`自动命名失败：${errorText(error)}`));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
