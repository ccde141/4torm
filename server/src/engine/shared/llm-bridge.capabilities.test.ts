import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveNativeMode } from './llm-bridge.js';

test('matching versioned transport cache controls automatic mode', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-capability-'));
  try {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({
      providers: [{
        id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['demo'],
        toolTransports: {
          demo: {
            status: 'text-required', checkedAt: 'now',
            fingerprint: '["pvd_test","https://example.test/v1","openai-chat-completions","demo","auto",2]',
          },
        },
      }],
    }));

    assert.deepEqual(await resolveNativeMode(dataDir, 'pvd_test:demo'), {
      native: false, mode: 'auto', forcedMismatch: false,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('transport cache from another endpoint is ignored', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-capability-'));
  try {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({
      providers: [{
        id: 'pvd_test', baseUrl: 'https://changed.test/v1', models: ['demo'],
        protocol: 'openai-chat-completions',
        toolTransports: {
          demo: {
            status: 'text-required', checkedAt: 'now',
            fingerprint: '["pvd_test","https://old.test/v1","openai-chat-completions","demo","auto",2]',
          },
        },
      }],
    }));

    assert.equal((await resolveNativeMode(dataDir, 'pvd_test:demo')).native, true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('automatic mode ignores unversioned negative probe results', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-capability-'));
  try {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({
      providers: [{
        id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['demo'],
        nativeProbe: { demo: { native: false, probedAt: 'old' } },
        modelCapabilities: {
          demo: { tools: { status: 'unsupported', checkedAt: 'old' } },
        },
      }],
    }));

    assert.deepEqual(await resolveNativeMode(dataDir, 'pvd_test:demo'), {
      native: true, mode: 'auto', forcedMismatch: false,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy forced mode no longer overrides automatic transport selection', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-capability-'));
  try {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({
      providers: [{
        id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['demo'],
        nativeMode: 'text',
      }],
    }));

    assert.deepEqual(await resolveNativeMode(dataDir, 'pvd_test:demo'), {
      native: true, mode: 'auto', forcedMismatch: false,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
