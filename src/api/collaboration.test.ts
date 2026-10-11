import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findOperationRecords, inspectOperation, invokeFeature, observeAllFeature, observeFeature,
  readCollaborationSnapshot, readOperationRecord, waitOperation,
} from './collaboration.js';

test('状态观察通过中心路由发送受预算约束的查询', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response(JSON.stringify({
      schemaVersion: 1, feature: 'tide', view: 'summary', revision: 'r1',
      observedAt: '2026-09-30T00:00:00.000Z', completeness: 'complete',
      items: [], truncated: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await observeFeature('tide', { view: 'summary', limit: 40 });
    assert.equal(captured?.input, '/api/collaboration/observe');
    assert.equal(captured?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
      feature: 'tide', query: { view: 'summary', limit: 40 },
    });
    assert.equal(result.feature, 'tide');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('等待运行和历史记录都携带精确身份与边界预算', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown; signal?: AbortSignal | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ items: [], text: '记录片段' });
  };
  const abort = new AbortController();
  try {
    await waitOperation('monsoon', 'session-1', 'run-1', 5000, abort.signal);
    await findOperationRecords('monsoon', { operationId: 'session-1', limit: 5 });
    await readOperationRecord('monsoon', 'session-1', 'run-1', { maxTextChars: 2000, maxTextLines: 40 });
    assert.deepEqual(requests.map(request => request.url), [
      '/api/collaboration/operation/wait', '/api/collaboration/records/find',
      '/api/collaboration/records/read',
    ]);
    assert.deepEqual(requests[0]?.body, {
      feature: 'monsoon', operationId: 'session-1', runId: 'run-1', timeoutMs: 5000,
    });
    assert.equal(requests[0]?.signal, abort.signal);
    assert.deepEqual(requests[1]?.body, {
      feature: 'monsoon', operationId: 'session-1', limit: 5,
    });
    assert.deepEqual(requests[2]?.body, {
      feature: 'monsoon', operationId: 'session-1', runId: 'run-1',
      maxTextChars: 2000, maxTextLines: 40,
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('完整状态读取逐页跟随中心游标且不吞掉重复游标错误', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const second = body.query.cursor === 'next-1';
    return new Response(JSON.stringify({
      schemaVersion: 1, feature: 'tide', view: 'summary', revision: 'r1',
      observedAt: '2026-09-30T00:00:00.000Z', completeness: second ? 'complete' : 'partial',
      items: [{ operationId: second ? 'task-2' : 'task-1', title: 'task', status: 'queued' }],
      truncated: !second, ...(second ? {} : { nextCursor: 'next-1' }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const items = await observeAllFeature('tide', { view: 'summary', limit: 1 });
    assert.deepEqual(items.map(item => item.operationId), ['task-1', 'task-2']);
    assert.deepEqual(bodies, [
      { feature: 'tide', query: { view: 'summary', limit: 1 } },
      { feature: 'tide', query: { view: 'summary', limit: 1, cursor: 'next-1' } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('功能调用通过中心路由发送明确的模组、方法和输入', async () => {
  const originalFetch = globalThis.fetch;
  let captured: unknown;
  globalThis.fetch = async (_input, init) => {
    captured = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ stopped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await invokeFeature('convection', 'abortRound', {
      sessionId: 'conv-1', runId: 'convection-run-1',
    });
    assert.deepEqual(result, { stopped: true });
    assert.deepEqual(captured, {
      feature: 'convection', method: 'abortRound',
      input: { sessionId: 'conv-1', runId: 'convection-run-1' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('全局协作快照通过单一中心入口读取', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({
      schemaVersion: 1, revision: 'snapshot-1', observedAt: '2026-09-30T00:00:00.000Z',
      completeness: 'complete', features: [],
    });
  };
  try {
    const snapshot = await readCollaborationSnapshot({ view: 'summary', limit: 8 });
    assert.equal(captured?.input, '/api/collaboration/snapshot');
    assert.equal(captured?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
      query: { view: 'summary', limit: 8 },
    });
    assert.equal(snapshot.revision, 'snapshot-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('执行卡按功能与双重身份精确读取中心运行事实', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({ feature: 'tradewind', operationId: 'wf-1', runId: 'run-1',
      title: '发布', status: 'completed', resultSummary: '发布完成' });
  };
  try {
    const fact = await inspectOperation('tradewind', 'wf-1', 'run-1');
    assert.equal(captured?.input, '/api/collaboration/operation');
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
      feature: 'tradewind', operationId: 'wf-1', runId: 'run-1',
    });
    assert.equal(fact.resultSummary, '发布完成');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
