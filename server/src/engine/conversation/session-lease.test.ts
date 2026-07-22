import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSessionLeases, tryAcquireSessionLease } from './session-lease.js';

test.beforeEach(() => clearSessionLeases());

test('同一会话只能持有一个运行 lease', () => {
  const release = tryAcquireSessionLease('agent-a', 'session-a');
  assert.ok(release);
  assert.equal(tryAcquireSessionLease('agent-a', 'session-a'), null);

  release();
  assert.ok(tryAcquireSessionLease('agent-a', 'session-a'));
});

test('同一 Agent 的不同会话可以同时持有 lease', () => {
  const first = tryAcquireSessionLease('agent-a', 'session-a');
  const second = tryAcquireSessionLease('agent-a', 'session-b');

  assert.ok(first);
  assert.ok(second);
});

test('重复释放旧 lease 不会清除后来持有者', () => {
  const first = tryAcquireSessionLease('agent-a', 'session-a');
  assert.ok(first);
  first();
  const second = tryAcquireSessionLease('agent-a', 'session-a');
  assert.ok(second);

  first();
  assert.equal(tryAcquireSessionLease('agent-a', 'session-a'), null);
});
