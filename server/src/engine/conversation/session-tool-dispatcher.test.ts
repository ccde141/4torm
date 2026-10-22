import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileChangeLedger } from './file-change-ledger.js';
import { createSessionToolCaller } from './session-tool-dispatcher.js';

test('session dispatcher returns explicit failed status without changing tool events', async () => {
  const events: Array<{ type: string; ok?: boolean }> = [];
  const caller = createSessionToolCaller({
    dataDir: 'unused', agentId: 'agent-a', model: 'provider:model',
    workspace: 'unused', sandboxLevel: 'project', signal: new AbortController().signal,
    guideToolDefs: [], ledger: new FileChangeLedger(), mainAgent: false,
    setPendingRegistration: () => undefined,
    emit: event => events.push(event),
  });

  assert.deepEqual(await caller.call('framework_status', {}), {
    result: '协作状态读取失败：当前入口未开放协作总览能力。', ok: false,
  });
  assert.deepEqual(events.map(event => ({ type: event.type, ...(event.ok !== undefined ? { ok: event.ok } : {}) })), [
    { type: 'tool-call' },
    { type: 'tool-result', ok: false },
  ]);
});

test('session dispatcher forwards task board conflict status without adding duplicate events', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-board-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: Array<{ type: string; ok?: boolean }> = [];
  const caller = createSessionToolCaller({
    dataDir, agentId: 'agent-a', model: 'provider:model', workspace: 'unused',
    sandboxLevel: 'project', signal: new AbortController().signal,
    guideToolDefs: [], ledger: new FileChangeLedger(), sessionId: 'session-a',
    setPendingRegistration: () => undefined, emit: event => events.push(event),
  });
  const args = { action: 'set', expectedRevision: 0,
    tasks: [{ title: 'Step', status: 'todo' }] };
  await caller.call('task_board', args);
  const conflict = await caller.call('task_board', args);

  assert.equal(typeof conflict, 'object');
  if (typeof conflict === 'string') return;
  assert.equal(conflict.ok, false);
  assert.match(conflict.result, /版本冲突/);
  assert.deepEqual(events.map(event => [event.type, event.ok]), [
    ['tool-call', undefined], ['tool-result', true],
    ['tool-call', undefined], ['tool-result', false],
  ]);
});
