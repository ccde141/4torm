import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvectionRoundRegistry } from './round-registry.js';

test('轮次注册表原子持有会话锁并以 runId 完成清理', () => {
  let locked = false;
  const registry = new ConvectionRoundRegistry(() => {
    if (locked) return null;
    locked = true;
    return () => { locked = false; };
  });

  const first = registry.begin('conv-1', 'public');
  assert.equal(locked, true);
  assert.equal(registry.signal('conv-1', first.runId).aborted, false);
  assert.throws(() => registry.begin('conv-1', 'chair'), hasCode('CONVECTION_ROUND_BUSY'));
  assert.throws(
    () => registry.finish('conv-1', 'convection-run-stale'),
    hasCode('CONVECTION_ROUND_CHANGED'),
  );
  assert.equal(locked, true);

  registry.finish('conv-1', first.runId);
  assert.equal(locked, false);
  assert.equal(registry.snapshot('conv-1'), null);
});

test('中止只触发当前轮次信号，不提前释放会话锁', () => {
  let released = false;
  const registry = new ConvectionRoundRegistry(() => () => { released = true; });
  const round = registry.begin('conv-2', 'chair');
  const signal = registry.signal('conv-2', round.runId);

  registry.abort('conv-2', round.runId);
  assert.equal(signal.aborted, true);
  assert.equal(released, false);
  registry.finish('conv-2', round.runId);
  assert.equal(released, true);
});

function hasCode(code: string): (error: unknown) => boolean {
  return error => (error as { data?: { code?: string } }).data?.code === code;
}
