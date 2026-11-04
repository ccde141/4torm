import assert from 'node:assert/strict';
import test from 'node:test';
import { readMemoryRecallSettings, saveMemoryRecallSettings, testMemoryRecallModel, testMemoryRecallEmbedding,
  memoryRecallLevels } from './memory-recall-settings';
import { resolveMessage } from '../i18n/locale';
import { memoryRecallError } from '../runtime-settings/memory-recall-errors';
import { ClientFrameworkError } from './error-contract';

test('memory model settings use the backend, separate save from verification, and forward cancellation', async t => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(String(input).endsWith('test-model')
      ? { model: 'p:model', selectedIds: ['language'], elapsedMs: 230 }
      : { version: 1, model: 'p:model' });
  });
  const signal = new AbortController().signal;
  await readMemoryRecallSettings(signal);
  await saveMemoryRecallSettings({ version: 1, model: 'p:model' }, signal);
  assert.equal(calls.length, 2);
  assert.equal((await testMemoryRecallModel('p:model', signal)).elapsedMs, 230);
  assert.equal(calls[2].url, '/api/settings/memory-recall/test-model');
  assert.equal(calls[2].init?.signal, signal);
  assert.equal(calls[2].init?.credentials, 'include');
  assert.equal(JSON.parse(String(calls[2].init?.body)).kind, 'search');
});

test('model-free recall settings round-trip and embedding verification uses its own request kind', async t => {
  const settings = { version: 1 as const, model: null, embeddingModel: null, enabled: true };
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (init) requests.push(init);
    return Response.json(String(input).endsWith('test-model')
      ? { model: 'p:embed', dimensions: 1024, elapsedMs: 10 } : settings);
  });
  assert.deepEqual(await saveMemoryRecallSettings(settings), settings);
  assert.deepEqual(await testMemoryRecallEmbedding('p:embed'), { dimensions: 1024, elapsedMs: 10 });
  assert.deepEqual(JSON.parse(String(requests[1].body)), { model: 'p:embed', kind: 'embedding' });
});

test('independent level switches round-trip without clearing saved models', async t => {
  const settings = { version: 1 as const, model: 'p:recall', embeddingModel: 'p:embed', level1Enabled: false, level2Enabled: false };
  t.mock.method(globalThis, 'fetch', async (_input, init) => Response.json(JSON.parse(String(init?.body))));
  assert.deepEqual(await saveMemoryRecallSettings(settings), settings);
  assert.deepEqual(memoryRecallLevels(settings), { level1Enabled: false, level2Enabled: false });
  assert.deepEqual(memoryRecallLevels({ ...settings, level2Enabled: true }), { level1Enabled: false, level2Enabled: true });
  assert.deepEqual(memoryRecallLevels({ version: 1, model: 'p:recall', enabled: true }), { level1Enabled: true, level2Enabled: true });
});

test('malformed responses and provider errors are not presented as successful model verification', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ version: 1 }));
  await assert.rejects(readMemoryRecallSettings());
  fetch.mock.mockImplementation(async () => Response.json({ model: 'wrong', selectedIds: [], elapsedMs: 1 }));
  await assert.rejects(testMemoryRecallModel('p:model'));
  fetch.mock.mockImplementation(async () => Response.json({ error: 'provider failed', errorCode: 'MODEL_FAILED' }, { status: 502 }));
  await assert.rejects(testMemoryRecallModel('p:model'), /provider failed/);
});

test('recall timing round-trips and invalid server timing is rejected', async t => {
  const settings = { version: 1 as const, model: 'p:recall', timing: 'before-send' as const };
  const fetch = t.mock.method(globalThis, 'fetch', async (_input, init) => Response.json(JSON.parse(String(init?.body))));
  assert.deepEqual(await saveMemoryRecallSettings(settings), settings);
  fetch.mock.mockImplementation(async () => Response.json({ ...settings, timing: 'both' }));
  await assert.rejects(readMemoryRecallSettings());
});

test('memory model settings and verification feedback are bilingual', () => {
  assert.equal(resolveMessage('en-US', 'recall.model'), 'Intermediate recall model');
  assert.equal(resolveMessage('zh-CN', 'recall.none'), '尚未配置');
  assert.equal(resolveMessage('en-US', 'recall.tested', { seconds: '0.23' }), 'Sample selection passed in 0.23 seconds');
  assert.equal(memoryRecallError(new ClientFrameworkError({ code: 'MEMORY_RECALL_OUTPUT_INVALID', message: '模型输出无效' }),
    key => resolveMessage('en-US', key)), 'The model did not return valid candidate IDs');
});
