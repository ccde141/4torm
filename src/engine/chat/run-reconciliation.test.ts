import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCurrentMonsoonRun, inspectMonsoonRun,
  reconcileMonsoonInterruption } from './run-reconciliation';

function response(status: string, extra: Record<string, unknown> = {}) {
  return async () => new Response(JSON.stringify({
    operationId: 'session-a', runId: 'run-a', title: 'session-a', status, ...extra,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('reports the persisted terminal state without resending the turn', async () => {
  let calls = 0;
  const request = async (...args: Parameters<typeof fetch>) => {
    calls++;
    return response('completed')(...args);
  };
  const result = await reconcileMonsoonInterruption('session-a', 'run-a', 'socket closed', request);
  assert.equal(result, '执行已完成，但回复未完整送达');
  assert.equal(calls, 1);
});

test('preserves public failure details and distinguishes an active run', async () => {
  assert.equal(await reconcileMonsoonInterruption('session-a', 'run-a', 'closed',
    response('failed', { errorMessage: '模型请求失败' })), '执行失败：模型请求失败');
  assert.equal(await reconcileMonsoonInterruption('session-a', 'run-a', 'closed',
    response('running')), '后端仍报告执行中');
});

test('falls back to the transport error when reconciliation is unavailable', async () => {
  const request = async () => new Response('{}', { status: 404 });
  assert.equal(await reconcileMonsoonInterruption('session-a', 'run-a', 'Failed to fetch', request),
    'Failed to fetch');
});

test('ask state inspection distinguishes waiting, terminal and missing runs', async () => {
  assert.equal((await inspectMonsoonRun('session-a', 'run-a', response('waiting')))?.status,
    'waiting');
  assert.equal((await inspectMonsoonRun('session-a', 'run-a', response('crashed')))?.status,
    'crashed');
  assert.equal(await inspectMonsoonRun('session-a', 'run-a', async () =>
    new Response('{}', { status: 404 })), null);
});

test('current ask inspection uses the live session run instead of archived run lookup', async () => {
  const request = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.method, 'getCurrentRun');
    assert.deepEqual(body.input, { sessionId: 'session-a' });
    return response('waiting')();
  };
  assert.equal((await inspectCurrentMonsoonRun('session-a', request))?.runId, 'run-a');
});
