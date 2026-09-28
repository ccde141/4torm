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
  const url = '/api/agents/activity';
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
  assert.equal(shouldLogRequest('GET', '/api/conversation/team/context?memberId=member-a', 200), true);
});
