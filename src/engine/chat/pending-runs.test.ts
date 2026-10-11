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
