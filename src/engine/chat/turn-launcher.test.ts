import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { StreamCtx } from './streamLoop';
import { launchMonsoonTurn, type TurnLauncherPorts } from './turn-launcher';

const agent: Agent = {
  id: 'agent-a', name: '季风', role: '', status: 'idle', model: 'model-a', description: '',
  createdAt: 'now', updatedAt: 'now', tasksCompleted: 0,
};
const messages: ChatMessage[] = [
  { id: 'old', role: 'user', content: '旧消息', timestamp: 'now' },
  { id: 'marker', role: 'system', type: 'compact-marker', content: '摘要', timestamp: 'now' },
  { id: 'new', role: 'user', content: '新消息', timestamp: 'now' },
];
const session = { id: 'session-a', agentId: agent.id, messages } as ChatSession;

function harness(existing = false) {
  const calls: string[] = [];
  let context: StreamCtx | undefined;
  let abort: (() => void) | undefined;
  const ports: TurnLauncherPorts = {
    hasRunner: () => existing,
    register: (_id, stop) => { calls.push('register'); abort = stop; },
    emit: () => calls.push('emit'),
    present: () => calls.push('present'),
    isAbandoned: () => false,
    finalize: (_id, completed) => calls.push(`finalize:${completed}`),
    saveSession: async value => ({ ...value, revision: (value.revision ?? 0) + 1 }),
    refreshSessions: () => undefined,
    applyTaskboard: () => undefined,
    generateMessageId: () => 'generated',
    run: async value => { calls.push('run'); context = value; value.onFinish?.(true); },
    reportError: error => calls.push(`error:${String(error)}`),
  };
  return { ports, calls, context: () => context, abort: () => abort?.() };
}

test('one launcher owns runner registration, compact history and completion', async () => {
  const h = harness();
  const launched = launchMonsoonTurn({ session, messages, agent, model: agent.model,
    firstRunId: 'followup-a' }, h.ports);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(launched, true);
  assert.deepEqual(h.calls, ['register', 'emit', 'present', 'run', 'finalize:true']);
  assert.deepEqual(h.context()?.chatMessages.map(message => message.content), ['[历史上下文摘要]\n摘要', '新消息']);
  assert.equal(h.context()?.generateMessageIdFn(), 'followup-a');
  assert.equal(h.context()?.generateMessageIdFn(), 'generated');
  h.abort();
  assert.equal(h.context()?.abortController.signal.aborted, true);
});

test('an existing runner rejects a second launch before any side effect', () => {
  const h = harness(true);
  assert.equal(launchMonsoonTurn({ session, messages, agent, model: agent.model }, h.ports), false);
  assert.deepEqual(h.calls, []);
});

test('conversation UI paths launch turns only through the application boundary', () => {
  for (const path of [
    new URL('../../components/chat/useMonsoonActions.ts', import.meta.url),
    new URL('../../components/chat/useHumanInput.ts', import.meta.url),
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /launchMonsoonTurn/);
    assert.doesNotMatch(source, /runStreamLoop/);
  }
});
