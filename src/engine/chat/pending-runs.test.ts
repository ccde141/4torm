import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import { hydratePendingRuns } from './pending-runs.js';

function session(): ChatSession {
  return {
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: 'New', model: 'model-a',
    systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', revision: 2, messageRevision: 1,
    messages: [{
      id: 'run-a', inputRunId: 'run-a', role: 'assistant', content: '',
      timestamp: '2026-01-01T00:00:01.000Z', agentId: 'agent-a',
      streamingPhase: 'llm-waiting',
    }],
  };
}

function waitingSession(): ChatSession {
  const value = session();
  value.messages.push({
    id: 'ask-a', role: 'assistant', content: '继续？', agentId: 'agent-a',
    timestamp: '2026-01-01T00:00:02.000Z',
    ask: { question: '继续？', answered: false, reply: '继续', sourceRunId: 'run-a' },
  });
  return value;
}

test('pending backend events restore a reply that the browser did not save', () => {
  const restored = hydratePendingRuns(session(), [{
    runId: 'run-a', truncated: false, events: [
      { type: 'token', content: 'hello' },
      { type: 'answer', content: 'hello', rawContent: 'hello' },
      { type: 'done' },
    ],
  }]);
  assert.equal(restored.messages[0]?.content, 'hello');
  assert.equal(restored.messages[0]?.streamingPhase, undefined);
});

test('pending journals cannot override the repository usage measurement or its unknown state', () => {
  const reported = { promptTokens: 30, completionTokens: 4, totalTokens: 34 };
  const base = { ...session(), tokenUsage: {
    promptTokens: 10, completionTokens: 2, totalTokens: 12,
  } };
  const current = hydratePendingRuns(base, [{ runId: 'run-a', truncated: false,
    events: [{ type: 'usage', usage: reported }] }]);
  assert.deepEqual(current.tokenUsage, base.tokenUsage);
  const unknown = hydratePendingRuns(session(), [{ runId: 'run-a', truncated: false,
    events: [{ type: 'usage', usage: reported }] }]);
  assert.equal(unknown.tokenUsage, undefined);
  const retained = hydratePendingRuns(base, [{ runId: 'run-a', truncated: false,
    events: [{ type: 'usage', usage: null }] }]);
  assert.deepEqual(retained.tokenUsage, base.tokenUsage);
});

test('an old failed run restores its message without replacing a newer call count', () => {
  const latest = { promptTokens: 50, completionTokens: 5, totalTokens: 55 };
  const restored = hydratePendingRuns({ ...session(), tokenUsage: latest }, [{
    runId: 'run-a', truncated: false, events: [
      { type: 'token', content: 'partial' },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 } },
      { type: 'error', message: 'old failure' },
    ],
  }]);
  assert.deepEqual(restored.tokenUsage, latest);
  assert.match(restored.messages[0]?.content ?? '', /partial/);
});

test('a torn journal preserves its valid prefix and states the missing tail', () => {
  const restored = hydratePendingRuns(session(), [{
    runId: 'run-a', truncated: true, events: [{ type: 'token', content: 'partial' }],
  }]);
  assert.match(restored.messages[0]?.content ?? '', /partial/);
  assert.match(restored.messages[0]?.content ?? '', /日志尾部不完整/);
  assert.equal(restored.messages[0]?.streamStopped, true);
});

test('reply acknowledgement restores the matching ask and one answer after reload', () => {
  const run = { runId: 'reply-b', truncated: false, events: [
    { type: 'reply-accepted', waitingRunId: 'run-a', answer: '继续' },
    { type: 'answer', content: '已继续', rawContent: '已继续' },
    { type: 'done' },
  ] };
  const first = hydratePendingRuns(waitingSession(), [run]);
  const second = hydratePendingRuns(first, [run]);

  assert.deepEqual(first.messages.find(message => message.id === 'ask-a')?.ask,
    { question: '继续？', answered: true, reply: '继续', sourceRunId: 'run-a' });
  assert.equal(second.messages.filter(message => message.id === 'reply-b').length, 1);
  assert.equal(second.messages.find(message => message.id === 'reply-b')?.content, '已继续');
});

test('without acknowledgement recovery keeps the recorded reply pending', () => {
  const restored = hydratePendingRuns(waitingSession(), [{
    runId: 'reply-b', truncated: false, events: [
      { type: 'answer', content: '已继续', rawContent: '已继续' }, { type: 'done' },
    ],
  }]);
  assert.equal(restored.messages.find(message => message.id === 'ask-a')?.ask?.answered, false);
  assert.equal(restored.messages.find(message => message.id === 'ask-a')?.ask?.reply, '继续');
});

test('an old acknowledgement cannot answer a newer ask', () => {
  const value = waitingSession();
  value.messages.push({
    id: 'ask-new', role: 'assistant', content: '更新的问题？', timestamp: 'later',
    ask: { question: '更新的问题？', answered: false, sourceRunId: 'run-new' },
  });
  const restored = hydratePendingRuns(value, [{
    runId: 'reply-b', truncated: false, events: [
      { type: 'reply-accepted', waitingRunId: 'run-a', answer: '继续' },
    ],
  }]);
  assert.equal(restored.messages.find(message => message.id === 'ask-a')?.ask?.answered, false);
  assert.equal(restored.messages.find(message => message.id === 'ask-new')?.ask?.answered, false);
});

test('an accepted reply stays attached to its ask when the resumed run asks again', () => {
  const restored = hydratePendingRuns(waitingSession(), [{
    runId: 'reply-b', truncated: false, events: [
      { type: 'reply-accepted', waitingRunId: 'run-a', answer: '继续' },
      { type: 'ask', question: '下一步？', options: ['停止'] },
      { type: 'done' },
    ],
  }]);
  assert.equal(restored.messages.find(message => message.id === 'ask-a')?.ask?.answered, true);
  assert.equal(restored.messages.at(-1)?.ask?.question, '下一步？');
  assert.equal(restored.messages.at(-1)?.ask?.answered, false);
});

test('reply acknowledgement also finds a legacy ask without sourceRunId', () => {
  const value = waitingSession();
  delete value.messages[1]?.ask?.sourceRunId;
  const restored = hydratePendingRuns(value, [{
    runId: 'reply-b', truncated: false, events: [
      { type: 'reply-accepted', waitingRunId: 'run-a', answer: '继续' },
    ],
  }]);
  assert.equal(restored.messages.find(message => message.id === 'ask-a')?.ask?.answered, true);
});

test('replaying a full pending journal replaces its partial snapshot instead of accumulating it', () => {
  const value = session();
  Object.assign(value.messages[0]!, { runCommitted: false, reasoningContent: 'before',
    toolSteps: [{ tool: 'read_file', args: { path: 'a' }, status: 'done', result: 'A' }] });
  const run = { runId: 'run-a', truncated: false, events: [
    { type: 'reasoning', content: 'before' },
    { type: 'tool-call', tool: 'read_file', args: { path: 'a' } },
    { type: 'tool-result', result: 'A' },
    { type: 'reasoning', content: 'after' },
    { type: 'ask', question: 'Continue?', options: ['Yes'] },
    { type: 'input-context', runId: 'run-a', checkpoint: {
      context: [{ role: 'assistant', content: 'snapshot' }], includedIds: [], closed: true,
    } }, { type: 'done' },
  ] };
  const first = hydratePendingRuns(value, [run]);
  const second = hydratePendingRuns(first, [run]);
  assert.equal(first.messages[0]?.reasoningContent, 'beforeafter');
  assert.equal(first.messages[0]?.toolSteps?.length, 1);
  assert.equal(first.messages[0]?.runCommitted, false);
  assert.deepEqual(second, first);
});

test('recovery retains the saved identity and human reply of a journal question', () => {
  const value = waitingSession();
  value.messages[1]!.ask!.answered = true;
  const run = { runId: 'run-a', truncated: false,
    events: [{ type: 'ask', question: '继续？' }, { type: 'done' }] };
  const first = hydratePendingRuns(value, [run]);
  const second = hydratePendingRuns(first, [run]);
  assert.equal(first.messages.filter(message => message.ask).length, 1);
  assert.equal(first.messages.find(message => message.ask)?.id, 'ask-a');
  assert.equal(first.messages.find(message => message.ask)?.ask?.answered, true);
  assert.equal(first.messages.find(message => message.ask)?.ask?.reply, '继续');
  assert.deepEqual(second, first);
});

test('committed human edits are not overwritten by an obsolete pending journal', () => {
  const value = session();
  Object.assign(value.messages[0]!, { runCommitted: true, content: 'human edit',
    nativeContext: [{ role: 'assistant', content: 'human edit' }] });
  const restored = hydratePendingRuns(value, [{ runId: 'run-a', truncated: false,
    events: [{ type: 'token', content: 'original' }, { type: 'answer', content: 'original' }] }]);
  assert.deepEqual(restored, value);
});

test('a torn journal never discards a newer saved snapshot and does not repeat its warning', () => {
  const value = session();
  Object.assign(value.messages[0]!, { content: 'partial later', reasoningContent: 'reasoning tail',
    toolSteps: [{ tool: 'read_file', args: { path: 'a' }, status: 'done', result: 'saved result' }],
    humanInputs: [{ id: 'human-a', content: 'insert', runId: 'run-a', sequence: 1,
      receivedAt: value.createdAt, state: 'received' }] });
  const run = { runId: 'run-a', truncated: true, events: [
    { type: 'reasoning', content: 'reasoning' }, { type: 'token', content: 'partial' },
    { type: 'tool-call', tool: 'read_file', args: { path: 'a' } },
  ] };
  const first = hydratePendingRuns(value, [run]);
  const second = hydratePendingRuns(first, [run]);
  assert.equal(first.messages[0]?.reasoningContent, 'reasoning tail');
  assert.match(first.messages[0]?.content ?? '', /^partial later/);
  assert.equal(first.messages[0]?.toolSteps?.[0]?.result, 'saved result');
  assert.equal(first.messages[0]?.humanInputs?.length, 1);
  assert.deepEqual(second, first);
});

test('a human edit of the exact retained context survives failed-run recovery', () => {
  const value = session();
  Object.assign(value.messages[0]!, { runCommitted: false, content: 'human edit',
    inputClosed: true, contextExact: true,
    nativeContext: [{ role: 'assistant', content: 'human edit' }] });
  const run = { runId: 'run-a', truncated: false, events: [
    { type: 'token', content: 'original' },
    { type: 'input-context', runId: 'run-a', checkpoint: {
      context: [{ role: 'assistant', content: 'original' }], includedIds: [], closed: true,
    } }, { type: 'error', message: 'model failure' },
  ] };
  const restored = hydratePendingRuns(value, [run]);
  assert.match(restored.messages[0]?.content ?? '', /^human edit/);
  assert.equal(restored.messages[0]?.nativeContext?.at(-1)?.content, 'human edit');
  assert.deepEqual(hydratePendingRuns(restored, [run]), restored);
});

test('an empty or torn journal retains evidence saved during a running compaction', () => {
  const value = session();
  Object.assign(value.messages[0]!, { reasoningContent: 'saved reasoning', inputRecoveryError: 'retained',
    compactionNotice: 'retained compaction notice' });
  assert.deepEqual(hydratePendingRuns(value, [{ runId: 'run-a', truncated: false, events: [] }]), value);
  const torn = hydratePendingRuns(value, [{ runId: 'run-a', truncated: true, events: [] }]);
  assert.equal(torn.messages[0]?.reasoningContent, 'saved reasoning');
  assert.equal(torn.messages[0]?.compactionNotice, 'retained compaction notice');
  assert.match(torn.messages[0]?.content ?? '', /日志尾部不完整/);
});

test('legacy questions retain their identity, answer and position before later conversation', () => {
  const value = waitingSession();
  delete value.messages[1]!.ask!.sourceRunId;
  value.messages[1]!.ask!.answered = true;
  value.messages.push({ id: 'user-b', role: 'user', content: 'later', timestamp: value.createdAt },
    { id: 'run-b', role: 'assistant', content: 'later reply', timestamp: value.createdAt, runCommitted: true });
  const run = { runId: 'run-a', truncated: false,
    events: [{ type: 'ask', question: '继续？' }, { type: 'done' }] };
  const first = hydratePendingRuns(value, [run]);
  assert.deepEqual(first.messages.map(message => message.id), ['run-a', 'ask-a', 'user-b', 'run-b']);
  assert.equal(first.messages[1]?.ask?.answered, true);
  assert.equal(first.messages[1]?.ask?.reply, '继续');
  assert.deepEqual(hydratePendingRuns(first, [run]), first);
});

test('recovery retains exact saved native tool context when the journal has no context replacement', () => {
  const value = session();
  const nativeContext = [{ role: 'assistant' as const, content: '', toolCalls: [
    { id: 'call-a', name: 'read_file', arguments: '{}' }],
  }, { role: 'tool' as const, content: 'result', toolCallId: 'call-a' }];
  Object.assign(value.messages[0]!, { runCommitted: false, inputClosed: true, contextExact: true, nativeContext });
  const restored = hydratePendingRuns(value, [{ runId: 'run-a', truncated: false,
    events: [{ type: 'reasoning', content: 'thinking' }, { type: 'error', message: 'failed' }] }]);
  assert.deepEqual(restored.messages[0]?.nativeContext, nativeContext);
  assert.equal(restored.messages[0]?.contextExact, true);
});

test('a torn journal checkpoint cannot replace a newer saved native context', () => {
  for (const inputClosed of [false, true]) {
    const value = session();
    const nativeContext = [{ role: 'assistant' as const, content: '', toolCalls: [
      { id: 'call-a', name: 'read_file', arguments: '{}' }],
    }, { role: 'tool' as const, content: 'result', toolCallId: 'call-a' }];
    Object.assign(value.messages[0]!, { inputClosed, contextExact: true, nativeContext,
      inputIncludedIds: ['human-a'] });
    const restored = hydratePendingRuns(value, [{ runId: 'run-a', truncated: true, events: [
      { type: 'input-context', runId: 'run-a', checkpoint: {
        context: nativeContext.slice(0, 1), includedIds: [], closed: false,
      } },
    ] }]);
    assert.deepEqual(restored.messages[0]?.nativeContext, nativeContext);
    assert.equal(restored.messages[0]?.inputClosed, inputClosed);
    assert.deepEqual(restored.messages[0]?.inputIncludedIds, ['human-a']);
  }
});
