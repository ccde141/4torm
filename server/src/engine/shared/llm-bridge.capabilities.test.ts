import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM, resolveNativeMode } from './llm-bridge.js';

test('only explicitly controlled length responses may return an empty nonstream body', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-output-control-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://example.test/v1', models: ['demo'],
  }] }));
  let finish = 'length';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ message: { content: '', reasoning_content: '未完成的思考' }, finish_reason: finish }],
  })));
  const params = { dataDir, fullModelKey: 'p:demo', messages: [{ role: 'user' as const, content: '压缩' }] };
  await assert.rejects(callLLM(params), /缺少.*content/);
  const result = await callLLM({ ...params, outputControl: { allowEmptyAtLimit: true } });
  assert.equal(result.content, '');
  assert.equal(result.reasoningContent, '未完成的思考');
  assert.equal(result.finishReason, 'length');
  finish = 'stop';
  await assert.rejects(callLLM({ ...params, outputControl: { allowEmptyAtLimit: true } }), /缺少.*content/);
});

test('body preference is request-local and takes effect after custom thinking settings', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-body-preference-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  for (const [providerType, model, disabled] of [
    ['deepseek', 'deepseek-v4-flash', true], ['kimi', 'kimi-k2.6', true], ['kimi', 'kimi-k2.7-code', false],
  ] as const) {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
      id: 'p', baseUrl: 'https://example.test/v1', models: [model], providerType,
      customRequestParameters: { thinking: { type: 'enabled' } },
    }] }));
    const received: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      received.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: '正文' }, finish_reason: 'stop' }] }));
    });
    const params = { dataDir, fullModelKey: `p:${model}`, messages: [{ role: 'user' as const, content: '压缩' }] };
    await callLLM({ ...params, outputControl: { preferBody: true } });
    await callLLM(params);
    assert.equal((received[0].thinking as { type: string }).type, disabled ? 'disabled' : 'enabled');
    assert.equal((received[1].thinking as { type: string }).type, 'enabled');
    assert.equal(received[0].reasoning_effort, undefined);
  }
});

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
