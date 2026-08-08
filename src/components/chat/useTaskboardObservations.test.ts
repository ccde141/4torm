import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('任务板在会话流结束后仍持续轮询活动执行，直到进入终态', () => {
  const source = fs.readFileSync('src/components/chat/useTaskboardObservations.ts', 'utf8');
  assert.match(source, /enabled \|\| hasActive/);
  assert.match(source, /status === 'running'/);
  assert.match(source, /status === 'cancelling'/);
  assert.match(source, /window\.setTimeout/);
  assert.doesNotMatch(source, /window\.setInterval/);
});
