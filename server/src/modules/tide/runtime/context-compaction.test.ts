import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { TideChangeFeed } from '../application/change-feed.js';
import type { TideTask } from '../domain/task.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideSession } from '../sessions/session-types.js';
import { readTideSession, writeTideSession } from '../sessions/session-store.js';
import { TideContextCompaction } from './context-compaction.js';
import { tideGeneratedMediaContext } from './turn-context.js';
import { resolveTarget, saveTurn } from '../sessions/session-resolver.js';
import { callPreparedModel } from '../../../engine/shared/react/model-call.js';

test('fixed-model fallback publishes a durable live notice before alternate execution and retains it in run history', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-compaction-notice-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const policy = { ...defaultCompactionPolicy(), enabled: true, modelMode: 'fixed' as const,
    fixedModel: 'p:fixed', thresholds: { ...defaultCompactionPolicy().thresholds, tide: 1000 } };
  await saveCompactionPolicy(dataDir, policy);
  const changes = new TideChangeFeed();
  const states = new FileTideRunStateRepository(dataDir, changes);
  const task = tideTask();
  const queued = await states.create(task.id, 'schedule');
  await states.markRunning(task.id, queued.runId);
  const fixture = sessionFixture(task);
  await writeTideSession(dataDir, fixture, task.id, task.name);
  const resolved = { sessionId: fixture.id, history: [], existing: fixture };
  const published: Array<Promise<string | undefined>> = [];
  const unsubscribe = changes.subscribe(event => { if (event.scope === 'run') {
    published.push(states.getRun(task.id, event.runId).then(state => state?.compactionNotice));
  } });
  const models: string[] = [];
  const compactor = new TideContextCompaction(dataDir, task, resolved, fixture, undefined, undefined,
    async message => { await states.recordCompactionNotice(task.id, queued.runId, message); }, {
      resolveSummaryBudget: async () => 100_000,
      summarize: async input => {
        models.push(input.model);
        if (input.model === 'p:fixed') throw new Error('offline');
        const state = await states.get(task.id);
        assert.equal(state?.status, 'running');
        assert.match(state?.compactionNotice ?? '', /p:fixed.*p:current/);
        assert.ok((await Promise.all(published)).some(message => message?.includes('p:fixed')));
        return 'Previous work is preserved in the archive; continue the latest request.';
      },
    }, async (event, sessionId) => {
      await states.recordCompactionProgress(task.id, queued.runId, event, sessionId);
    });
  const messages: ContextMessage[] = [{ role: 'system', content: 'Static identity' },
    ...fixture.messages.map(message => ({ role: message.role as 'user' | 'assistant', content: message.content })),
    { role: 'user', content: 'Continue with the next step.' }];
  await callPreparedModel(compactor.transform({ call: async () => ({ content: 'Completed', finishReason: 'stop' }) }),
    messages, new AbortController().signal, {});
  await assertFinalFacts(dataDir, task, queued.runId, states, compactor.notices);
  assert.deepEqual(models, ['p:fixed', 'p:current']);
  unsubscribe();
});

test('a real automatic compaction rebases current turn media before rolling retention', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-compaction-media-boundary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const policy = { ...defaultCompactionPolicy(), enabled: true,
    thresholds: { ...defaultCompactionPolicy().thresholds, tide: 1000 } };
  await saveCompactionPolicy(dataDir, policy);
  const task = { ...tideTask(), windowN: 2 };
  const first = await saveTurn(dataDir, task, await resolveTarget(dataDir, task), 'A', 'p:m', '',
    'old input '.repeat(500), 'old result '.repeat(14_000));
  Object.assign(task, first);
  const resolved = await resolveTarget(dataDir, task);
  const input: ContextMessage = { role: 'user', content: 'current input' };
  const toolImages = [{ id: '9dfd2154-439d-4d17-9769-622084b76321', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const messages: ContextMessage[] = [{ role: 'system', content: 'identity' }, ...resolved.history, input,
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'mcp:desktop:observe', arguments: '{}' }] },
    { role: 'tool', content: 'image metadata', toolCallId: 'call', toolImages }];
  const compactor = new TideContextCompaction(dataDir, task, resolved, resolved.existing!, undefined, undefined, undefined,
    { summarize: async () => 'old summary', resolveSummaryBudget: async () => 100_000 });
  await callPreparedModel(compactor.transform({ call: async () => ({ content: 'current answer', finishReason: 'stop' }) }),
    messages, new AbortController().signal, {});
  assert.ok(messages.some(message => message.content === '[历史压缩记录]\nold summary'));
  assert.ok(!messages.some(message => message.content.includes('old input')));
  messages.push({ role: 'assistant', content: 'current answer' });
  await compactor.checkpoint(messages);
  resolved.turnContext = tideGeneratedMediaContext(messages, input);
  assert.ok(resolved.turnContext?.some(message => message.toolImages?.length));
  const saved = await saveTurn(dataDir, task, resolved, 'A', 'p:m', '', 'current input', 'current answer');
  const restored = await resolveTarget(dataDir, { ...task, ...saved });
  assert.deepEqual(restored.history.filter(message => message.role === 'tool').map(message => message.toolImages), [toolImages]);
  assert.equal(restored.history.filter(message => message.content === 'current answer').length, 1);
  assert.ok(restored.history.every(message => !message.content.includes('old input')));
});

async function assertFinalFacts(dataDir: string, task: TideTask, runId: string,
  states: FileTideRunStateRepository, notices: string[]): Promise<void> {
  const runs = new FileTideRunRepository(dataDir);
  await runs.save({ taskId: task.id, runId, timestamp: new Date().toISOString(), status: 'success',
    sessionId: 'session-a', answer: 'Completed', rawContent: 'Completed', toolCalls: [],
    turns: 1, durationMs: 1, notices });
  await states.finish(task.id, runId, 'completed');
  assert.equal((await states.get(task.id))?.compactionNotice, notices[0]);
  assert.equal((await states.get(task.id))?.compaction?.type, 'compact-done');
  assert.deepEqual((await runs.get(task.id, runId))?.notices, notices);
  const persisted = await readTideSession(dataDir, task.agentId, 'session-a');
  assert.equal(persisted?.messages[0].content, 'First completed request '.repeat(300));
  assert.equal(persisted?.messages.at(-1)?.type, 'compact-marker');
}

function sessionFixture(task: TideTask): TideSession {
  return { id: 'session-a', agentId: task.agentId, agentName: 'Worker', title: 'Daily check',
    model: 'p:current', systemPrompt: 'Static identity', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), messages: [
      { id: 'u1', role: 'user', content: 'First completed request '.repeat(300) },
      { id: 'a1', role: 'assistant', content: 'Verified result '.repeat(300) },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-user-${index}`, role: 'user', content: `Recent request ${index}` },
        { id: `recent-answer-${index}`, role: 'assistant', content: `Recent answer ${index}` },
      ]).flat(),
    ] };
}

function tideTask(): TideTask {
  return { id: 'task-a', name: 'Daily check', schedule: 'every 5m', prompt: 'Continue', agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate', windowN: 6, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: new Date().toISOString() };
}
