import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionSurfaceCapabilityRegistry,
  executionSurfaceCapabilities,
  type ExecutionSurfaceCapability,
} from './execution-surface-capability';

test('built-in surface capabilities declare rendering, retention, and lifecycle semantics', () => {
  const terminal = executionSurfaceCapabilities.require('terminal');
  const browser = executionSurfaceCapabilities.require('browser');
  const computer = executionSurfaceCapabilities.require('computer');

  assert.deepEqual([terminal.renderMode, terminal.retainAfterCompletion, terminal.lifecycle.endpoint], ['terminal', true, 'terminate']);
  assert.deepEqual([browser.renderMode, browser.retainAfterCompletion, browser.lifecycle.endpoint], ['native-when-embedded', false, 'close']);
  assert.deepEqual([computer.renderMode, computer.retainAfterCompletion, computer.lifecycle.endpoint], ['visual', true, 'terminate']);
});

test('surface capability registry rejects duplicate viewers and unknown viewers', () => {
  const registry = new ExecutionSurfaceCapabilityRegistry();
  const capability: ExecutionSurfaceCapability = {
    viewer: 'browser',
    renderMode: 'visual',
    retainAfterCompletion: false,
    fallbackLabel: 'Browser',
    lifecycle: {
      endpoint: 'close', actionLabel: 'Close', pendingLabel: 'Closing...',
      confirmTitle: 'Close?', confirmLabel: 'Close', confirmMessage: 'Close this surface.',
    },
  };
  registry.register(capability);

  assert.throws(() => registry.register(capability), /surface capability browser is already registered/);
  assert.throws(() => registry.require('missing'), /surface capability missing is not registered/);
});
