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
import { readTideSession } from '../sessions/session-store.js';
import { TideContextCompaction } from './context-compaction.js';

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
    });
  const messages: ContextMessage[] = [{ role: 'system', content: 'Static identity' },
    ...fixture.messages.map(message => ({ role: message.role as 'user' | 'assistant', content: message.content })),
    { role: 'user', content: 'Continue with the next step.' }];
  await compactor.transform({ call: async () => ({ content: 'Completed', toolCalls: [] }) })
    .call(messages, {}, () => {}, new AbortController().signal);
  await assertFinalFacts(dataDir, task, queued.runId, states, compactor.notices);
  assert.deepEqual(models, ['p:fixed', 'p:current']);
  unsubscribe();
});

async function assertFinalFacts(dataDir: string, task: TideTask, runId: string,
  states: FileTideRunStateRepository, notices: string[]): Promise<void> {
  const runs = new FileTideRunRepository(dataDir);
  await runs.save({ taskId: task.id, runId, timestamp: new Date().toISOString(), status: 'success',
    sessionId: 'session-a', answer: 'Completed', rawContent: 'Completed', toolCalls: [],
    turns: 1, durationMs: 1, notices });
  await states.finish(task.id, runId, 'completed');
  assert.equal((await states.get(task.id))?.compactionNotice, notices[0]);
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
    ] };
}

function tideTask(): TideTask {
  return { id: 'task-a', name: 'Daily check', schedule: 'every 5m', prompt: 'Continue', agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate', windowN: 6, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: new Date().toISOString() };
}
