import assert from 'node:assert/strict';
import test from 'node:test';
import { abortConvectionRound, readConvectionRound, readConvectionRoundStatus } from './convection-runtime.js';

test('对流终态保留失败原因供断流后的界面恢复', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({
    schemaVersion: 1, feature: 'convection', view: 'summary', revision: 'r1',
    observedAt: '2026-09-30T00:00:00.000Z', completeness: 'complete', truncated: false,
    items: [{ operationId: 'conv-1', title: '会议', status: 'failed', phase: 'public',
      runId: 'run-1', errorMessage: '模型请求失败' }],
  });
  try {
    assert.deepEqual(await readConvectionRoundStatus('conv-1'), {
      status: 'failed', runId: 'run-1', errorMessage: '模型请求失败',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('对流运行态只从中心探针读取当前会话的轮次身份', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({
    schemaVersion: 1, feature: 'convection', view: 'summary', revision: 'r1',
    observedAt: '2026-09-30T00:00:00.000Z', completeness: 'complete', truncated: false,
    items: [{
      operationId: 'conv-1', title: '会议', status: 'running', phase: 'chair',
      runId: 'convection-run-1',
    }],
  });
  try {
    assert.deepEqual(await readConvectionRound('conv-1'), {
      round: 'chair', runId: 'convection-run-1',
    });
    assert.equal(await readConvectionRound('missing'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('对流中止先确认中心轮次再发送带身份的命令', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (body.query) return response({
      schemaVersion: 1, feature: 'convection', view: 'summary', revision: 'r1',
      observedAt: '2026-09-30T00:00:00.000Z', completeness: 'complete', truncated: false,
      items: [{ operationId: 'conv-1', title: '会议', status: 'running',
        phase: 'public', runId: 'convection-run-1' }],
    });
    return response({ stopped: true, sessionId: 'conv-1', runId: 'convection-run-1' });
  };
  try {
    await abortConvectionRound('conv-1');
    assert.deepEqual(bodies[1], {
      feature: 'convection', method: 'abortRound',
      input: { sessionId: 'conv-1', runId: 'convection-run-1' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
