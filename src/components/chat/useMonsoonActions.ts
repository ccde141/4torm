import { backendFetch } from '../../lib/backend-client';
import { useRef } from 'react';
import { mayApplyAskSnapshot } from '../../engine/chat/ask-status';
import { decidePendingAskInputRoute, findLatestAnswerableAsk } from '../../engine/chat/pending-ask';
import { deleteConversationAttachment, uploadImageDraft } from '../../engine/chat/image-attachments';
import { requestConversationStop } from '../../engine/chat/conversation-stop';
import { resumeMonsoonTurn } from '../../engine/chat/resume-turn';
import { submitMonsoonTurn } from '../../engine/chat/submit-turn';
import { launchMonsoonTurn } from '../../engine/chat/turn-launcher';
import {
  createSession, generateMessageId, getSession, getSessionSnapshot,
  nameCompletedSession, saveSession,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { MessageKey, MessageValues } from '../../i18n/locale';
import type { useStreamRunners } from './useStreamRunners';
import type { useHumanInput } from './useHumanInput';
import type { useSessionList } from './useSessionList';
import type { useMonsoonImages } from './useMonsoonImages';
import type { useMonsoonScroll } from './useMonsoonScroll';
import type { useMonsoonTaskboard } from './useMonsoonTaskboard';
import { useAskReplyFeedback } from './useAskReplyFeedback';

type Translate = (key: MessageKey, values?: MessageValues) => string;

interface MonsoonActionOptions {
  selectedAgent: Agent | null;
  selectedModel: string;
  activeSessionId: string | null;
  streaming: boolean;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  messages: ChatMessage[];
  setMessages(messages: ChatMessage[]): void;
  setStreaming(value: boolean): void;
  messagesRef: React.RefObject<ChatMessage[]>;
  selectedAgentIdRef: React.RefObject<string | null>;
  activeSessionIdRef: React.RefObject<string | null>;
  runners: ReturnType<typeof useStreamRunners>;
  human: ReturnType<typeof useHumanInput>;
  sessions: ReturnType<typeof useSessionList>;
  images: ReturnType<typeof useMonsoonImages>;
  scroll: ReturnType<typeof useMonsoonScroll>;
  taskboard: ReturnType<typeof useMonsoonTaskboard>;
  translate: Translate;
}

export function useMonsoonActions(options: MonsoonActionOptions) {
  const sending = useRef(false);
  const replying = useRef(new Set<string>());
  const askCheckSequence = useRef(0);
  const pendingAsk = findLatestAnswerableAsk(options.messages);
  const askFeedback = useAskReplyFeedback(options.activeSessionId, pendingAsk, options.streaming);

  const answer = async (messageId: string, answerText: string, fromComposer = false) => {
    const { selectedAgent: agent, activeSessionId: sessionId } = options;
    if (!agent || !sessionId) return;
    const target = findLatestAnswerableAsk(options.messagesRef.current);
    if (!target || target.id !== messageId) {
      askFeedback.report(messageId, 'expired'); return;
    }
    if (decidePendingAskInputRoute(target, askFeedback.feedback, options.streaming) !== 'answer'
      || replying.current.has(sessionId)) return;
    replying.current.add(sessionId);
    askFeedback.report(messageId, 'submitting');
    try {
      await resumeAsk(options, agent, sessionId, target.runId, messageId, answerText, {
        accepted: () => {
          askFeedback.report(messageId, 'accepted');
          if (fromComposer) options.setInput(previous => previous.trim() === answerText ? '' : previous);
        },
        rejected: detail => {
          askFeedback.report(messageId, 'failed', detail);
          void askFeedback.check();
        },
        uncertain: detail => askFeedback.report(messageId, 'unknown', detail),
      });
    } catch (error) {
      askFeedback.report(messageId, 'failed', String(error));
    }
    finally { replying.current.delete(sessionId); }
  };

  const send = async () => {
    const text = options.input.trim();
    const drafts = options.images.drafts;
    if ((!text && !drafts.length) || !options.selectedAgent || options.human.busy) return;
    const target = findLatestAnswerableAsk(options.messagesRef.current);
    const route = decidePendingAskInputRoute(target, askFeedback.feedback, options.streaming);
    if (route === 'blocked') return;
    if (route === 'answer' && target) {
      if (drafts.length) { options.images.setError(options.translate('chat.ask.noImages')); return; }
      await answer(target.id, text, true); return;
    }
    const pending = options.human.pending.find(entry => entry.input.content === text);
    if (pending) { await options.human.check(pending); return; }
    if (route === 'steer' || options.human.pending.some(entry => options.human.isWorking(entry.input.id))) {
      await steer(options, text, drafts.length > 0); return;
    }
    if (options.sessions.compacting || sending.current) return;
    sending.current = true;
    if (text === '/compact' && !drafts.length) {
      sending.current = false;
      await compact(options);
      return;
    }
    try { await submit(options, text); }
    finally { sending.current = false; }
  };

  const stop = () => {
    const sessionId = options.activeSessionId;
    if (!sessionId) return;
    if (options.sessions.compacting) { options.sessions.cancelCompaction(); return; }
    const runner = options.runners.runners.current.get(sessionId);
    if (!runner || runner.userStopped) return;
    if (!runner.runId) { options.images.setError('执行标识尚未建立，无法安全停止'); return; }
    options.images.setError('');
    void requestConversationStop(sessionId, runner.runId, runner)
      .catch(error => options.images.setError(error instanceof Error ? error.message : String(error)));
  };
  const checkAsk = async () => {
    const sessionId = options.activeSessionId;
    if (!sessionId) return;
    const baseline = { sessionId, messages: options.messagesRef.current,
      sequence: ++askCheckSequence.current };
    try {
      const session = await getSessionSnapshot(sessionId);
      if (!session || !mayApplyAskSnapshot(baseline, {
        sessionId: options.activeSessionIdRef.current,
        messages: options.messagesRef.current, sequence: askCheckSequence.current,
        busy: replying.current.has(sessionId) || options.runners.runners.current.has(sessionId),
      })) return;
      options.setMessages(session.messages);
      if (findLatestAnswerableAsk(session.messages)?.id === pendingAsk?.id) await askFeedback.check();
    } catch (error) { options.images.setError(String(error)); }
  };
  return { answer, send, stop, compacting: options.sessions.compacting, askFeedback, checkAsk };
}

async function resumeAsk(options: MonsoonActionOptions, agent: Agent, sessionId: string,
  waitingRunId: string, messageId: string, answer: string,
  feedback: { accepted(): void; rejected(detail: string): void; uncertain(detail: string): void }) {
  await resumeMonsoonTurn({ sessionId, agent, model: options.selectedModel,
    askMessageId: messageId, waitingRunId, answer }, {
    request: backendFetch, loadSession: getSession,
    onCompaction: event => options.runners.onCompaction(sessionId, event),
    begin: (abort, initial) => {
      options.runners.register(sessionId, abort, initial);
      if (options.activeSessionIdRef.current === sessionId) options.setStreaming(true);
      else options.runners.background(sessionId);
    },
    emit: messages => options.runners.emit(sessionId, messages),
    syncLatest: messages => {
      if (options.activeSessionIdRef.current === sessionId) options.setMessages(messages);
    },
    bufferedMessages: () => options.runners.runners.current.get(sessionId)?.messages,
    isAbandoned: () => options.runners.runners.current.get(sessionId)?.abandoned ?? false,
    saveSession, refreshSessions: options.sessions.refreshSessions,
    applyTaskboard: board => { if (options.activeSessionIdRef.current === sessionId) options.taskboard.applyAgent(board); },
    generateMessageId, nameSession: nameCompletedSession,
    errorMessage: detail => options.translate('chat.page.error', { detail }),
    saveFailureMessage: detail => options.translate('chat.page.replySaveFailed', { detail }),
    persistenceError: options.images.setError,
    ...feedback,
    finalize: completed => {
      options.runners.finalize(sessionId, completed);
      void options.sessions.refreshSessions(agent);
    },
  });
}

async function steer(options: MonsoonActionOptions, text: string, hasImages: boolean) {
  if (hasImages) { options.images.setError(options.translate('chat.page.imageAfterReply')); return; }
  try { await options.human.send(text); }
  catch (error) { options.images.setError(String(error)); }
}

async function compact(options: MonsoonActionOptions) {
  options.setInput('');
  if (!options.activeSessionId) return;
  const session = await getSession(options.activeSessionId);
  if (!session) return;
  await options.sessions.compactSession(session);
}

async function submit(options: MonsoonActionOptions, text: string) {
  const agent = options.selectedAgent!;
  const startingSessionId = options.activeSessionId;
  let createdVisibleId: string | null = null;
  await submitMonsoonTurn({ agent, model: options.selectedModel, sessionId: startingSessionId,
    text, drafts: options.images.drafts, messages: options.messagesRef.current }, {
    hasRunner: id => options.runners.runners.current.has(id),
    presentRunner: options.runners.reconnect, createSession, loadSession: getSession,
    deleteImage: deleteConversationAttachment, uploadImage: uploadImageDraft, generateMessageId,
    prepared: turn => {
      const visible = turn.sessionId === null
        ? options.selectedAgentIdRef.current === agent.id
          && options.activeSessionIdRef.current === startingSessionId
        : options.activeSessionIdRef.current === turn.sessionId || createdVisibleId === turn.sessionId;
      if (!visible) return;
      options.setMessages(turn.messages); options.scroll.followRef.current = true;
      requestAnimationFrame(() => options.scroll.scrollToBottom('smooth'));
      options.setInput('');
      if (turn.usedDrafts) options.images.setDrafts([]);
      options.images.setError(''); options.setStreaming(true);
    },
    rollback: (id, original) => {
      if (options.activeSessionIdRef.current === id || createdVisibleId === id
        || (id === null && options.activeSessionIdRef.current === startingSessionId)) {
        options.setMessages(original); options.setStreaming(false);
      }
    },
    sessionCreated: created => {
      options.sessions.refreshSessions(agent);
      if (options.selectedAgentIdRef.current === agent.id
        && options.activeSessionIdRef.current === startingSessionId) {
        createdVisibleId = created.id; options.activeSessionIdRef.current = created.id;
        options.sessions.setActiveSessionId(created.id);
      }
    },
    launch: value => launch(options, value),
    reportError: error => options.selectedAgentIdRef.current === agent.id
      ? options.images.setError(String(error)) : console.error('[chat] 消息准备失败', error),
  });
}

function launch(options: MonsoonActionOptions, value: Parameters<typeof launchMonsoonTurn>[0]) {
  return launchMonsoonTurn(value, {
    hasRunner: id => options.runners.runners.current.has(id),
    register: options.runners.register, emit: options.runners.emit,
    onCompaction: options.runners.onCompaction,
    present: id => options.activeSessionIdRef.current === id
      ? void options.runners.reconnect(id) : options.runners.background(id),
    isAbandoned: id => options.runners.runners.current.get(id)?.abandoned ?? false,
    finalize: (id, completed) => {
      options.runners.finalize(id, completed);
      void options.sessions.refreshSessions(value.agent);
    }, saveSession,
    refreshSessions: options.sessions.refreshSessions, generateMessageId,
    applyTaskboard: (id, board) => {
      if (options.activeSessionIdRef.current === id) options.taskboard.applyAgent(board);
    },
    reportError: error => {
      if (options.activeSessionIdRef.current === value.session.id) options.images.setError(String(error));
    },
  });
}
