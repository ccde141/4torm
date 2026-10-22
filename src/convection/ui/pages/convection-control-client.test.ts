import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConvectionSession,
  deleteConvectionMessage,
  deleteConvectionSession,
  editConvectionMessage,
  joinConvectionSession,
  leaveConvectionSession,
  openConvectionWorkspace,
  renameConvectionSession,
  reorderConvectionSession,
  resetConvectionContext,
  compactConvectionContext,
  compactConvectionChairContext,
  resetConvectionChairContext,
  setConvectionChair,
} from './convection-control-client.js';

test('manual meeting compact and chair reset retain scoped identities through the central router', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    signals.push(init?.signal);
    return Response.json({ ok: true });
  };
  try {
    const controller = new AbortController();
    await compactConvectionContext('conv-a', controller.signal);
    await compactConvectionChairContext('conv-a', controller.signal);
    await resetConvectionChairContext('conv-a', controller.signal);
    assert.deepEqual(signals, [controller.signal, controller.signal, controller.signal]);
    assert.deepEqual(calls.map(call => [call.method, call.input]), [
      ['compactContext', { sessionId: 'conv-a' }],
      ['compactChairContext', { sessionId: 'conv-a' }],
      ['resetChairContext', { sessionId: 'conv-a' }],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('对流前端控制动作只通过中心协作入口', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.method === 'createSession') return Response.json({ id: 'conv-1', title: '讨论' });
    if (body.method === 'resetContext') return Response.json({
      ok: true, mode: 'clean', archived: '001.json', summaryFailed: false,
    });
    if (body.method === 'openWorkspace') return Response.json({ ok: true, path: 'workspace' });
    return Response.json({ ok: true });
  };
  try {
    assert.equal((await createConvectionSession({
      chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
    })).id, 'conv-1');
    await renameConvectionSession('conv-1', '新标题');
    await joinConvectionSession('conv-1', 'agent-b');
    await leaveConvectionSession('conv-1', 'agent-b');
    await reorderConvectionSession('conv-1', ['agent-a']);
    await setConvectionChair('conv-1', 'chair-b');
    await editConvectionMessage('conv-1', 0, '修订');
    await deleteConvectionMessage('conv-1', 0);
    await resetConvectionContext('conv-1', 'clean');
    await openConvectionWorkspace('conv-1');
    await deleteConvectionSession('conv-1');
    assert.deepEqual(calls.map(call => call.method), [
      'createSession', 'renameSession', 'joinSession', 'leaveSession',
      'reorderSession', 'setChair', 'editMessage', 'deleteMessage',
      'resetContext', 'openWorkspace', 'deleteSession',
    ]);
    assert.ok(calls.every(call => call.feature === 'convection'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
