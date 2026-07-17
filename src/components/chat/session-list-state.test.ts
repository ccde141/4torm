import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplySessionRefresh } from './session-list-state';

test('background agent refresh cannot replace the visible agent session list', () => {
  assert.equal(shouldApplySessionRefresh('agent-2', 'agent-1'), false);
  assert.equal(shouldApplySessionRefresh('agent-1', 'agent-1'), true);
  assert.equal(shouldApplySessionRefresh('agent-1', null), false);
});
