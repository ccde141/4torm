import assert from 'node:assert/strict';
import test from 'node:test';
import { createTideNavigationIntent } from './tide-navigation-intent.js';

test('手动选择 B 后迟到的外部 A 导航不能覆盖或重启', () => {
  const navigation = createTideNavigationIntent();
  const old = navigation.begin('task-a');
  assert.ok(old);
  navigation.manualSelection('task-a');
  assert.equal(old.isCurrent(), false);
  assert.equal(navigation.begin('task-a'), null);
  const next = navigation.begin('task-b');
  assert.ok(next?.isCurrent());
});
