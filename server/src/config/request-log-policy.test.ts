import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldLogRequest } from './request-log-policy.js';

test('信风自动保存成功时不打印请求日志', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/save', 200), false);
});

test('信风自动保存失败时仍打印请求日志', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/save', 500), true);
});

test('其他非高频请求继续打印', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/run', 200), true);
});

test('气旋派发索引轮询成功时静默，失败时保留日志', () => {
  const url = '/api/cyclone/workshop/cyc-a/dispatches';
  assert.equal(shouldLogRequest('GET', url, 200), false);
  assert.equal(shouldLogRequest('GET', url, 500), true);
});

test('气旋工作室活动快照成功时静默，失败时保留日志', () => {
  const url = '/api/cyclone/workshop/cyc-a/activities';
  assert.equal(shouldLogRequest('GET', url, 200), false);
  assert.equal(shouldLogRequest('GET', url, 500), true);
});

test('气旋可见工位活动轮询成功时静默，失败时保留日志', () => {
  const url = '/api/cyclone/workshop/cyc-a/seat/seat-a/activity?since=12';
  assert.equal(shouldLogRequest('GET', url, 200), false);
  assert.equal(shouldLogRequest('GET', url, 500), true);
});

test('Agent 活动轮询成功时静默，失败时保留日志', () => {
  const url = '/api/collaboration/presence';
  assert.equal(shouldLogRequest('GET', url, 200), false);
  assert.equal(shouldLogRequest('GET', url, 500), true);
});

test('会话观察轮询成功时静默，失败时保留日志', () => {
  const observations = '/api/tools/observations?scope=conversation&ownerId=session-a';
  const team = '/api/conversation/team?agentId=agent-a&sessionId=session-a';
  assert.equal(shouldLogRequest('GET', observations, 200), false);
  assert.equal(shouldLogRequest('GET', observations, 500), true);
  assert.equal(shouldLogRequest('GET', team, 200), false);
  assert.equal(shouldLogRequest('GET', team, 500), true);
  assert.equal(shouldLogRequest('GET', '/api/conversation/team/context?memberId=member-a', 200), false);
});

test('成功的浏览、探针和记录查询静默，失败仍可见', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(shouldLogRequest(method, '/api/agents', 200), false);
    assert.equal(shouldLogRequest(method, '/api/agents', 503), true);
  }
  for (const path of ['observe', 'snapshot', 'operation', 'operation/wait',
    'records/find', 'records/read', 'records/agents/latest']) {
    const url = `/api/collaboration/${path}?cursor=private`;
    assert.equal(shouldLogRequest('POST', url, 200), false);
    assert.equal(shouldLogRequest('POST', url, 409), true);
  }
});

test('统一调用按注册协议区分查询和命令，完整日志模式可显式打开', () => {
  const url = '/api/collaboration/invoke';
  assert.equal(shouldLogRequest('POST', url, 200, 'query'), false);
  assert.equal(shouldLogRequest('POST', url, 200, 'command'), true);
  assert.equal(shouldLogRequest('POST', url, 200), true);
  assert.equal(shouldLogRequest('POST', url, 500, 'query'), true);
  assert.equal(shouldLogRequest('POST', url, 200, 'query', true), true);
  assert.equal(shouldLogRequest('GET', '/api/health', 200, undefined, true), true);
});

test('真实 HTTP 日志使用协议元数据过滤，且不输出参数或查询串', async () => {
  const { default: Fastify } = await import('fastify');
  const { installRequestLogging } = await import('./request-logger.js');
  const app = Fastify({ logger: false });
  const lines: string[] = [];
  installRequestLogging(app, [{ id: 'tide', methods: [
    { id: 'unusualQueryName', kind: 'query' }, { id: 'readButMutates', kind: 'command' },
  ] }], { write: line => lines.push(line), detailed: false });
  app.post('/api/collaboration/invoke', async (_request, reply) => {
    if (_request.headers['x-test-failure']) return reply.code(503).send({ error: 'failed' });
    return { ok: true };
  });
  try {
    await app.inject({ method: 'POST', url: '/api/collaboration/invoke',
      payload: { feature: 'tide', method: 'unusualQueryName' } });
    assert.equal(lines.length, 0);
    await app.inject({ method: 'POST', url: '/api/collaboration/invoke?token=private-query',
      payload: { feature: 'tide', method: 'readButMutates', input: { secret: 'private-body' } } });
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /tide\.readButMutates/);
    assert.doesNotMatch(lines[0]!, /private-query|private-body|token=|secret/);
    await app.inject({ method: 'POST', url: '/api/collaboration/invoke',
      headers: { 'x-test-failure': '1' },
      payload: { feature: 'tide', method: 'unusualQueryName' } });
    assert.equal(lines.length, 2);
    assert.match(lines[1]!, /503/);
  } finally { await app.close(); }
});
