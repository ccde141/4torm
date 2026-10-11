import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readModelCapability,
  retainProviderCapabilities,
  writeModelCapability,
  type CapabilityProbe,
} from './model-capabilities.js';

test('legacy native probe remains readable as tool capability', () => {
  const provider = {
    nativeProbe: { demo: { native: true, probedAt: '2026-01-01T00:00:00.000Z' } },
  };

  assert.deepEqual(readModelCapability(provider, 'demo', 'tools'), {
    status: 'supported',
    checkedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('negative results from the old behavioral probe are discarded', () => {
  assert.equal(readModelCapability({
    nativeProbe: { demo: { native: false, probedAt: 'old' } },
  }, 'demo', 'tools'), undefined);

  assert.equal(readModelCapability({
    modelCapabilities: {
      demo: { tools: { status: 'unsupported', checkedAt: 'old' } },
    },
  }, 'demo', 'tools'), undefined);
});

test('versioned explicit rejection remains a valid unsupported result', () => {
  assert.equal(readModelCapability({
    modelCapabilities: {
      demo: { tools: { status: 'unsupported', checkedAt: 'now', method: 'forced-tool-v1' } },
    },
  }, 'demo', 'tools')?.status, 'unsupported');
});

test('structured capability result takes priority and preserves sibling results', () => {
  const vision: CapabilityProbe = { status: 'supported', checkedAt: 'now' };
  const first = writeModelCapability(undefined, 'demo', 'vision', vision);
  const next = writeModelCapability(first, 'demo', 'tools', {
    status: 'unsupported', checkedAt: 'later',
  });

  assert.strictEqual(next.demo?.vision, vision);
  assert.equal(next.demo?.tools?.status, 'unsupported');
});

test('removing models clears structured and legacy capability records together', () => {
  const retained = retainProviderCapabilities({
    modelCapabilities: {
      keep: { vision: { status: 'supported', checkedAt: 'now' } },
      remove: { tools: { status: 'unsupported', checkedAt: 'then' } },
    },
    nativeProbe: {
      keep: { native: true, probedAt: 'now' },
      remove: { native: false, probedAt: 'then' },
    },
    toolTransports: {
      keep: { status: 'native-confirmed', checkedAt: 'now', fingerprint: 'keep' },
      remove: { status: 'text-required', checkedAt: 'then', fingerprint: 'remove' },
    },
  }, ['keep']);

  assert.deepEqual(retained, {
    modelCapabilities: {
      keep: { vision: { status: 'supported', checkedAt: 'now' } },
    },
    nativeProbe: {
      keep: { native: true, probedAt: 'now' },
    },
    toolTransports: {
      keep: { status: 'native-confirmed', checkedAt: 'now', fingerprint: 'keep' },
    },
  });
});
