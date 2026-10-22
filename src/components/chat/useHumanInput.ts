import { backendFetch } from '../../lib/backend-client';
import { useEffect, useRef, useState } from 'react';
import { deliverHumanInput, type InputSubmission } from '../../engine/chat/input-submission';
import { InputOutbox, type PendingInput } from '../../engine/chat/input-outbox';
import { continueInputTurn } from '../../engine/chat/input-continuation';
import { launchMonsoonTurn } from '../../engine/chat/turn-launcher';
import { generateMessageId, getSession, saveSession, type ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { TaskBoard } from '../../utils/taskboard';
import type { useStreamRunners } from './useStreamRunners';

interface Options {
  agent: Agent | null;
  sessionId: string | null;
  model: string;
  runners: ReturnType<typeof useStreamRunners>;
  refresh: (agent: Agent) => void;
  getMessages: () => ChatMessage[];
  onTaskboard: (sessionId: string, board: TaskBoard | null) => void;
  clearText: (text: string) => void;
}

function reserveOrder(tails: Map<string, Promise<void>>, sessionId: string) {
  const before = tails.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; });
  tails.set(sessionId, tail);
  return { before, finish: () => {
    release();
    if (tails.get(sessionId) === tail) tails.delete(sessionId);
  } };
}

export function useHumanInput(options: Options) {
  const [pending, setPending] = useState<PendingInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [outbox] = useState(() => new InputOutbox(localStorage));
  const locked = useRef(new Set<string>());
  const submitting = useRef(new Map<string, string>());
  const handoffs = useRef(new Map<string, Promise<void>>());
  const deliveryOrder = useRef(new Map<string, Promise<void>>());
  const active = useRef(options.sessionId);
  useEffect(() => {
    active.current = options.sessionId;
    setRecoveryError('');
    try {
      setPending(options.sessionId ? outbox.read(options.sessionId).map(entry => locked.current.has(entry.input.id)
        ? entry : { ...entry, state: 'retained' }) : []);
    }
    catch (error) { setPending([]); setRecoveryError(String(error)); }
    setBusy(options.sessionId ? submitting.current.has(options.sessionId) : false);
  }, [options.sessionId, outbox]);

  function update(value: PendingInput) {
    outbox.put(value);
    if (active.current === value.input.sessionId) setPending(outbox.read(value.input.sessionId));
  }

  function release(input: InputSubmission) {
    if (submitting.current.get(input.sessionId) !== input.id) return;
    submitting.current.delete(input.sessionId);
    if (active.current === input.sessionId) setBusy(false);
  }

  function enqueue(input: InputSubmission, agent: Agent, cancelled: () => boolean): Promise<void> {
    const previous = handoffs.current.get(input.sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const running = options.runners.runners.current.get(input.sessionId);
      if (running && !await running.settled) throw new Error('执行已中止，消息已保留 / Execution stopped; message retained');
      await continueInputTurn(input, { load: getSession, save: saveSession,
        canStart: () => !options.runners.runners.current.has(input.sessionId) && !cancelled(),
        start: (session, runId) => start(session, runId, agent) });
    });
    handoffs.current.set(input.sessionId, next);
    void next.finally(() => {
      if (handoffs.current.get(input.sessionId) === next) handoffs.current.delete(input.sessionId);
    }).catch(() => {});
    return next;
  }

  function start(session: ChatSession, runId: string, agent: Agent) {
    const launched = launchMonsoonTurn({
      session, messages: session.messages, agent, model: options.model, firstRunId: runId,
    }, {
      hasRunner: id => options.runners.runners.current.has(id),
      register: options.runners.register,
      onCompaction: options.runners.onCompaction,
      emit: options.runners.emit,
      present: id => {
        if (active.current === id) options.runners.reconnect(id);
        else options.runners.background(id);
      },
      isAbandoned: id => options.runners.runners.current.get(id)?.abandoned ?? false,
      finalize: options.runners.finalize,
      saveSession,
      refreshSessions: options.refresh,
      generateMessageId,
      applyTaskboard: options.onTaskboard,
      reportError: error => console.error('[chat] 续接轮次启动失败', error),
    });
    if (!launched) throw new Error('会话已有执行，消息已保留 / Conversation is already running');
  }

  async function execute(input: InputSubmission, checkOnly: boolean) {
    if (locked.current.has(input.id) || !options.agent || options.agent.id !== input.agentId) return;
    const agent = options.agent;
    const runner = options.runners.runners.current.get(input.sessionId);
    const order = reserveOrder(deliveryOrder.current, input.sessionId);
    locked.current.add(input.id);
    submitting.current.set(input.sessionId, input.id);
    setBusy(true);
    try {
      update({ input, state: 'sending' });
      options.clearText(input.content);
      if (runner) await runner.ready;
      const state = await deliverHumanInput(input, { request: backendFetch,
        notify: state => {
          update({ input, state });
          if (state !== 'sending') release(input);
        },
        settled: async () => {
          const completed = await (runner?.settled ?? Promise.resolve(true));
          await order.before;
          return completed;
        },
        nextTurn: value => enqueue(value, agent, () => !!runner?.abandoned || !!runner?.userStopped),
      }, checkOnly);
      if (state === 'retained') update({ input, state });
      else {
        outbox.remove(input.sessionId, input.id);
        if (active.current === input.sessionId) setPending(outbox.read(input.sessionId));
      }
    } catch (error) {
      const value: PendingInput = { input, state: 'retained', error: String(error) };
      try { update(value); }
      catch { if (active.current === input.sessionId) setPending(entries => [...entries.filter(entry => entry.input.id !== input.id), value]); }
    } finally {
      order.finish();
      locked.current.delete(input.id);
      release(input);
    }
  }

  async function send(text: string) {
    const { sessionId, agent } = options;
    if (!sessionId || !agent || submitting.current.has(sessionId)) return;
    const saved = outbox.read(sessionId).find(entry => entry.input.content === text);
    if (saved) return execute(saved.input, true);
    const runner = options.runners.runners.current.get(sessionId);
    const target = (runner?.messages ?? options.getMessages()).findLast(message => message.inputRunId);
    if (!target?.inputRunId || runner?.userStopped || text.startsWith('/')) {
      throw new Error('请等待执行就绪；会话指令需在空闲时执行。');
    }
    await execute({ agentId: agent.id, sessionId, runId: target.inputRunId,
      id: generateMessageId(), content: text }, false);
  }
  return { pending: pending.filter(entry => entry.input.sessionId === options.sessionId), busy, recoveryError,
    isWorking: (id: string) => locked.current.has(id), send,
    check: (entry: PendingInput) => execute(entry.input, true) };
}
