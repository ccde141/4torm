import type { ChatSession } from '../../store/chat';
import type { ChatMessage } from '../../types';
import { MonsoonMessageProjection } from './monsoon-projection';
import { findLatestAnswerableAsk } from './pending-ask';
import type { MonsoonBrowserEvent } from './sse-events';
import { retainStopped } from './stream-retention';
import { interruptedStreamContent } from './stream-terminal';
import { buildConversationHistory } from './conversation-history';

export interface PendingMonsoonRun {
  runId: string;
  events: MonsoonBrowserEvent[];
  truncated: boolean;
}

export function hydratePendingRuns(
  session: ChatSession,
  runs: PendingMonsoonRun[],
): ChatSession {
  let current = structuredClone(session);
  for (const run of runs) current = hydrateRun(current, run);
  return current;
}

function hydrateRun(session: ChatSession, run: PendingMonsoonRun): ChatSession {
  const original = session.messages.find(message => message.id === run.runId);
  if (original?.runCommitted === true) return session;
  if (original && !run.events.length && !run.truncated) return session;
  const questions = savedQuestions(session.messages, run);
  const replayedIds = new Set(questions.flatMap(message => message ? [message.id] : []));
  let messages = ensurePlaceholder(session.messages.filter(message => !replayedIds.has(message.id)),
    run.runId, session.agentId).map(message => message.id === run.runId ? replayPlaceholder(message, run) : message);
  let generated = 0;
  const projection = new MonsoonMessageProjection(
    messages, run.runId, session.agentId, () => questions[generated++]?.id ?? `recovered-${run.runId}-${generated}`,
  );
  let failure = '';
  let compacted: ChatMessage | undefined;
  let accepted: { id: string; answer: string } | undefined;
  for (const event of run.events) {
    if (event.type === 'error') {
      failure = typeof event.message === 'string' ? event.message : '执行失败';
      continue;
    }
    if (event.type === 'reply-accepted') {
      const target = findLatestAnswerableAsk(projection.messages);
      if (target && target.runId === event.waitingRunId && typeof event.answer === 'string') {
        accepted = { id: target.id, answer: event.answer };
      }
      continue;
    }
    if (event.type !== 'usage') projection.apply(event);
    if (event.type === 'context-compacted') compacted = projection.messages.find(message => message.id === run.runId);
    else if (event.type === 'input-context' || (event.type === 'answer' && Array.isArray(event.nativeContext))) compacted = undefined;
  }
  messages = restoreQuestionOrder(restoreSavedState(projection.messages, run, original, questions, compacted),
    session.messages, run.runId);
  if (accepted) messages = markAcceptedAsk(messages, accepted);
  messages = closeRecoveredRun(messages, run, failure);
  return { ...session, messages };
}

function closeRecoveredRun(messages: ChatMessage[], run: PendingMonsoonRun, failure: string): ChatMessage[] {
  if (!failure && !run.truncated) return messages;
  const reason = failure || '运行日志尾部不完整';
  const stopped = messages.map(message => message.id === run.runId
    ? { ...message, content: message.content.endsWith(`(连接中断: ${reason})`)
      ? message.content : interruptedStreamContent(message.content, reason) }
    : message);
  return retainStopped(stopped, run.runId);
}

/** A journal starts at the beginning of a run, never at the saved snapshot's tail. */
function replayPlaceholder(message: ChatMessage, run: PendingMonsoonRun): ChatMessage {
  const result = { ...message, content: '' };
  const fields: Array<keyof ChatMessage> = ['reasoningContent', 'reasoningBreaks', 'toolSteps', 'activitySequence',
    'native', 'streamStopped', 'inputSkipped', 'compactionNotice',
    'streamingPhase', 'streamingStatus', 'streamingTool', 'streamingArgumentChars', 'phaseElapsed'];
  if (run.events.some(event => event.type === 'input-context' || event.type === 'context-compacted'
    || (event.type === 'answer' && Array.isArray(event.nativeContext)))) fields.push('nativeContext', 'contextExact');
  for (const field of fields) delete result[field];
  return result;
}

function savedQuestions(messages: ChatMessage[], run: PendingMonsoonRun): Array<ChatMessage | undefined> {
  const used = new Set<string>();
  return run.events.filter(event => event.type === 'ask').map(event => {
    const saved = messages.find(message => !used.has(message.id) && message.ask
      && questionBelongsToRun(message, messages, run.runId)
      && message.ask.question === event.question);
    if (saved) used.add(saved.id);
    return saved;
  });
}

function questionBelongsToRun(message: ChatMessage, messages: ChatMessage[], runId: string): boolean {
  if (message.ask?.sourceRunId) return message.ask.sourceRunId === runId;
  if (message.id.startsWith(`recovered-${runId}-`)) return true;
  const index = messages.indexOf(message);
  return messages.slice(0, index).findLast(item => item.role === 'assistant' && !item.ask)?.id === runId;
}

/** Questions belong beside their run, never after a later user's or agent's turn. */
function restoreQuestionOrder(messages: ChatMessage[], source: ChatMessage[], runId: string): ChatMessage[] {
  const questions = messages.filter(message => message.ask?.sourceRunId === runId);
  const ids = new Set(questions.map(message => message.id));
  const result = messages.filter(message => !ids.has(message.id));
  for (const question of questions) {
    const ownIndex = source.findIndex(message => message.id === question.id);
    const start = ownIndex < 0 ? source.findIndex(message => message.id === runId) : ownIndex;
    const next = start < 0 ? undefined
      : source.slice(start + 1).find(message => result.some(item => item.id === message.id));
    const index = next ? result.findIndex(message => message.id === next.id) : result.length;
    result.splice(index, 0, question);
  }
  return result;
}

function restoreSavedState(messages: ChatMessage[], run: PendingMonsoonRun,
  original: ChatMessage | undefined, questions: Array<ChatMessage | undefined>, compacted?: ChatMessage): ChatMessage[] {
  return messages.map(message => {
    const question = questions.find(saved => saved?.id === message.id);
    if (question?.ask && message.ask) return { ...message,
      ask: { ...message.ask, answered: question.ask.answered,
        ...('reply' in question.ask ? { reply: question.ask.reply } : {}) },
      timestamp: question.timestamp };
    if (message.id !== run.runId) return message;
    const restored = { ...message, ...(original ? { timestamp: original.timestamp } : {}) };
    if (compacted) {
      const visible = run.truncated && original ? retainSavedPrefix(restored, original, false) : restored;
      return { ...visible, ...contextAfterCompaction(visible, compacted, run) };
    }
    if (!original) return restored;
    const last = original.nativeContext?.at(-1);
    // Human edits update the exact final context too; replay must not undo that edit.
    if (original.inputClosed && original.contextExact && last?.role === 'assistant'
      && !last.toolCalls?.length && last.content && (last.content === original.content
        || original.content.startsWith(`${last.content}\n\n(连接中断:`))) {
      restored.content = original.content;
      restored.nativeContext = original.nativeContext;
    }
    return run.truncated ? retainSavedPrefix(restored, original,
      !run.events.some(event => event.type === 'context-compacted')) : restored;
  });
}

/** Keep raw display records, but only post-compaction work can re-enter the model. */
function contextAfterCompaction(message: ChatMessage, boundary: ChatMessage,
  run: PendingMonsoonRun): Pick<ChatMessage, 'nativeContext' | 'contextExact'> {
  const after = (value = '', prefix = '') => value.startsWith(prefix) ? value.slice(prefix.length) : value;
  const terminal = run.events.findLast(event => event.type === 'error');
  const reason = terminal ? String(terminal.message || '执行失败') : run.truncated ? '运行日志尾部不完整' : '';
  const notice = `(连接中断: ${reason})`;
  // The visible framework notice is not model output, including on a second recovery.
  const received = reason && message.content.endsWith(`\n\n${notice}`)
    ? message.content.slice(0, -(notice.length + 2)) : reason && message.content === notice ? '' : message.content;
  const tail: ChatMessage = { ...message, content: after(received, boundary.content),
    reasoningContent: after(message.reasoningContent, boundary.reasoningContent),
    toolSteps: message.toolSteps?.slice(boundary.toolSteps?.length ?? 0), toolCall: undefined,
    nativeContext: undefined, contextExact: false, streamStopped: false };
  const nativeContext = buildConversationHistory([tail]).filter(item => item.role !== 'assistant'
    || item.content || item.reasoningContent || item.toolCalls?.length);
  return { nativeContext, contextExact: true };
}

/** A torn journal can be older than a saved snapshot: retain its already received evidence. */
function retainSavedPrefix(replayed: ChatMessage, original: ChatMessage, retainNative: boolean): ChatMessage {
  const result = { ...original, ...replayed };
  if (!retainNative && !replayed.nativeContext) {
    delete result.nativeContext;
    delete result.contextExact;
  }
  if (original.content.startsWith(result.content)) result.content = original.content;
  if (original.reasoningContent?.startsWith(result.reasoningContent ?? '')) {
    result.reasoningContent = original.reasoningContent;
    result.reasoningBreaks = original.reasoningBreaks;
  }
  const replayedSteps = result.toolSteps ?? [];
  const savedSteps = original.toolSteps ?? [];
  if (savedSteps.length >= replayedSteps.length && replayedSteps.every((step, index) =>
    step.tool === savedSteps[index]?.tool && JSON.stringify(step.args) === JSON.stringify(savedSteps[index]?.args))) {
    result.toolSteps = savedSteps.map((step, index) => replayedSteps[index]?.result === undefined
      ? step : { ...step, ...replayedSteps[index] });
  }
  const sequence = result.activitySequence ?? [];
  const savedSequence = original.activitySequence ?? [];
  if (savedSequence.length >= sequence.length && sequence.every((item, index) => {
    const saved = savedSequence[index];
    if (item.kind === 'text' && saved?.kind === 'text') return index === sequence.length - 1
      ? saved.content.startsWith(item.content) : saved.content === item.content;
    return JSON.stringify(item) === JSON.stringify(saved);
  })) result.activitySequence = original.activitySequence;
  if (retainNative && original.nativeContext && original.contextExact && (!replayed.nativeContext
    || isContextPrefix(replayed.nativeContext, original.nativeContext))) {
    result.nativeContext = original.nativeContext;
    result.contextExact = original.contextExact;
    result.inputClosed = original.inputClosed;
    result.inputIncludedIds = original.inputIncludedIds;
    result.humanInputs = result.humanInputs?.map(input =>
      original.humanInputs?.find(saved => saved.id === input.id) ?? input);
  }
  return result;
}

function isContextPrefix(prefix: NonNullable<ChatMessage['nativeContext']>,
  saved: NonNullable<ChatMessage['nativeContext']>): boolean {
  return prefix.length <= saved.length && prefix.every((message, index) =>
    JSON.stringify(message) === JSON.stringify(saved[index]));
}

function markAcceptedAsk(messages: ChatMessage[], accepted: { id: string; answer: string }): ChatMessage[] {
  return messages.map(message => message.id === accepted.id && message.ask && !message.ask.answered
    ? { ...message, ask: { ...message.ask, answered: true, reply: accepted.answer } }
    : message);
}

function ensurePlaceholder(
  messages: ChatMessage[],
  runId: string,
  agentId: string,
): ChatMessage[] {
  if (messages.some(message => message.id === runId)) return messages;
  return [...messages, {
    id: runId, inputRunId: runId, role: 'assistant', content: '', agentId,
    timestamp: new Date(0).toISOString(), streamingPhase: 'llm-waiting',
  }];
}
