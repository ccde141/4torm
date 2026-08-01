import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionCapabilityRegistry, type ExecutionCapabilityProvider } from './execution-capability-registry.js';

function provider(id: string, toolName = id, viewer = id): ExecutionCapabilityProvider {
  return {
    id,
    tool: { name: toolName, execute: async () => `${id}:ok` },
    surface: { viewer, close: async () => undefined },
  };
}

test('execution capability registry resolves tools and surfaces through stable public keys', async () => {
  const registry = new ExecutionCapabilityRegistry();
  registry.register(provider('browser'));

  assert.equal(await registry.requireTool('browser').execute({ dataDir: '', agentId: '', args: {} }), 'browser:ok');
  assert.equal(registry.requireSurface('browser').viewer, 'browser');
  assert.equal(registry.hasTool('run_command'), false);
});

test('execution capability registry rejects ambiguous registrations', () => {
  const registry = new ExecutionCapabilityRegistry();
  registry.register(provider('browser'));

  assert.throws(() => registry.register(provider('browser', 'computer', 'computer')), /capability id browser is already registered/);
  assert.throws(() => registry.register(provider('computer', 'browser', 'computer')), /tool browser is already registered/);
  assert.throws(() => registry.register(provider('computer', 'computer', 'browser')), /surface viewer browser is already registered/);
});

test('execution capability registry reports missing capability operations explicitly', () => {
  const registry = new ExecutionCapabilityRegistry();

  assert.throws(() => registry.requireTool('browser'), /execution capability tool browser is not registered/);
  assert.throws(() => registry.requireSurface('browser'), /execution surface provider browser is not registered/);
});
