import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import { FileTideRunStateRepository } from './run-state-repository.js';
import { commitTideCompaction } from '../sessions/compaction-store.js';
import { readTideSession, writeTideSession } from '../sessions/session-store.js';
import { FileTideTaskRepository } from './task-repository.js';
import { createTideFeature } from '../api/factory.js';

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-compaction-crash-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const task = { id: 'task', name: '日报', agentId: 'agent', prompt: '继续', schedule: 'every 1h',
    enabled: true, repeatCount: -1, pushMode: 'accumulate' as const, targetSessionId: 'session', windowN: 6,
    selfLoop: false, consecutiveErrors: 0, createdAt: timestamp };
  const session = { id: 'session', agentId: 'agent', agentName: 'A', title: '日报', model: 'p:model',
    systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'user', role: 'user', content: '原始任务'.repeat(1000) },
      { id: 'assistant', role: 'assistant', content: '原始结果'.repeat(1000) },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-user-${index}`, role: 'user', content: `最近要求${index}` },
        { id: `recent-answer-${index}`, role: 'assistant', content: `最近回复${index}` },
      ]).flat()] };
  await writeTideSession(directory, session, task.id, task.name);
  await new FileTideTaskRepository(directory).upsert(task);
  const repository = new FileTideRunStateRepository(directory);
  const run = await repository.create(task.id, 'schedule', task.agentId);
  await repository.markRunning(task.id, run.runId);
  return { directory, task, session, repository, run };
}

test('hard process exit during summary recovers original Tide context and settles the persisted spinner', async t => {
  const { directory, task, session, repository, run } = await fixture(t);
  const policy = defaultCompactionPolicy(); policy.enabled = true; policy.thresholds.tide = 1_000;
  await saveCompactionPolicy(directory, policy);
  const script = path.join(directory, 'crash-worker.mjs');
  await fs.writeFile(script, `
    import { TideContextCompaction } from ${JSON.stringify(new URL('../runtime/context-compaction.ts', import.meta.url).href)};
    import { FileTideRunStateRepository } from ${JSON.stringify(new URL('./run-state-repository.ts', import.meta.url).href)};
    import { callPreparedModel } from ${JSON.stringify(new URL('../../../engine/shared/react/model-call.ts', import.meta.url).href)};
    const directory = ${JSON.stringify(directory)};
    const task = ${JSON.stringify(task)};
    const session = ${JSON.stringify(session)};
    const states = new FileTideRunStateRepository(directory);
    const compactor = new TideContextCompaction(directory, task,
      { sessionId: session.id, history: [], existing: session }, session, undefined, undefined, undefined,
      { resolveSummaryBudget: async () => 100000, summarize: async () => {
        setInterval(() => {}, 1000); process.stdout.write('SUMMARIZING\\n');
        return new Promise(() => {});
      } }, (event, sessionId) => states.recordCompactionProgress(task.id, ${JSON.stringify(run.runId)}, event, sessionId));
    await callPreparedModel(compactor.transform({ call: async () => { throw new Error('must not reach model'); } }), [
      { role: 'system', content: 'rules' }, ...session.messages, { role: 'user', content: 'continue' }
    ], new AbortController().signal, {});
  `);
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: process.cwd(),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += String(data); });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', data => { if (String(data).includes('SUMMARIZING')) resolve(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`worker exited before summary: ${diagnostics}`)));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await ready;
    assert.equal((await repository.get(task.id))?.compaction?.type, 'compact-start');
    const snapshot = await createTideFeature({ dataDir: directory }).tasks.readSession(task.agentId, session.id);
    assert.equal(snapshot.compaction?.type, 'compact-start');
    assert.deepEqual(snapshot.messages, session.messages);
    child.kill('SIGKILL'); await exited;
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  const reloaded = new FileTideRunStateRepository(directory);
  assert.equal(await reloaded.recoverCrashed(), 1);
  const recovered = await reloaded.get(task.id);
  assert.equal(recovered?.status, 'crashed');
  assert.equal(recovered?.compaction?.type, 'compact-failed');
  assert.equal(recovered?.compaction?.aborted, true);
  assert.deepEqual(await readTideSession(directory, task.agentId, session.id, task), session);
});

test('crash after marker commit but before done notification recovers successful compaction', async t => {
  const { directory, task, session, repository, run } = await fixture(t);
  const startedAt = Date.now();
  await repository.recordCompactionProgress(task.id, run.runId, { type: 'compact-start', id: 'compact-1',
    operation: 'compact', reason: 'threshold', startedAt, updatedAt: startedAt }, session.id);
  const next = { ...session, messages: [...session.messages,
    { id: 'marker', role: 'system', type: 'compact-marker' as const, compactionId: 'compact-1',
      content: '完整摘要', timestamp: new Date().toISOString(), nativeContext: [{ role: 'system' as const, content: '完整摘要' }] }] };
  await commitTideCompaction(directory, task, session, next);
  const reloaded = new FileTideRunStateRepository(directory);
  await reloaded.recoverCrashed();
  assert.equal((await reloaded.get(task.id))?.compaction?.type, 'compact-done');
  assert.equal((await reloaded.get(task.id))?.compaction?.aborted, undefined);
  assert.deepEqual(await readTideSession(directory, task.agentId, session.id, task), next);
});
