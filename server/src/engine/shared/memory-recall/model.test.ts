import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { callMemoryRecallModel } from './model.js';
import { loadMemoryRecallSettings, saveMemoryRecallSettings, recallLevels } from './settings.js';
import { MemoryRecallSettingsService } from '../../../modules/runtime-settings/memory-recall-settings.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ activeModel: 'a:chat', providers: [
    { id: 'a', baseUrl: 'https://unused.invalid/v1', models: ['chat', 'recall:tag'] },
    { id: 'b', baseUrl: 'https://unused.invalid/v1', models: ['other'] },
  ] }));
  return dataDir;
}
const input = { query: '语言约定', candidates: [{ id: 'language', summary: '文档使用中文' }] };

test('recall settings are independent, can be cleared, and saving performs no inference', async t => {
  const dataDir = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('inference must not run'); });
  assert.deepEqual(await loadMemoryRecallSettings(dataDir), { version: 1, model: null });
  const original = await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8');
  const service = new MemoryRecallSettingsService(dataDir);
  await service.write({ version: 1, model: 'a:recall:tag' });
  assert.equal((await service.read()).model, 'a:recall:tag');
  await service.write({ version: 1, model: 'b:other' });
  await assert.rejects(service.write({ version: 1, model: 'b:missing' }), /模型列表/);
  assert.equal((await service.read()).model, 'b:other');
  await service.write({ version: 1, model: null });
  assert.equal((await service.read()).model, null);
  assert.equal(await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8'), original);
});

test('invalid or corrupted recall settings never silently replace a saved choice', async t => {
  const dataDir = await fixture(t);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'a:chat' });
  for (const value of [null, {}, { version: 1, model: '' }, { version: 2, model: null },
    { version: 1, model: 'a:chat', apiKey: 'unexpected' }]) {
    await assert.rejects(saveMemoryRecallSettings(dataDir, value));
  }
  const file = path.join(dataDir, 'memory-recall-settings.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(loadMemoryRecallSettings(dataDir), /原文件已保留/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('recall levels are independent, preserve disabled model choices and validate only enabled selections', async t => {
  const dataDir = await fixture(t);
  assert.deepEqual(recallLevels({ version: 1, model: null }), { level1Enabled: false, level2Enabled: false });
  assert.deepEqual(recallLevels({ version: 1, model: null, enabled: true }), { level1Enabled: true, level2Enabled: false });
  assert.deepEqual(recallLevels({ version: 1, model: 'a:chat', enabled: true }), { level1Enabled: true, level2Enabled: true });
  const disabled = { version: 1 as const, model: 'removed:recall', embeddingModel: 'removed:embed',
    level1Enabled: false, level2Enabled: false };
  assert.deepEqual(await saveMemoryRecallSettings(dataDir, disabled), disabled);
  await assert.rejects(saveMemoryRecallSettings(dataDir, { ...disabled, level1Enabled: true }), /模型列表/);
  await assert.rejects(saveMemoryRecallSettings(dataDir, { ...disabled, level2Enabled: true }), /模型列表/);
  await assert.rejects(saveMemoryRecallSettings(dataDir, { version: 1, model: null, level2Enabled: true }), /请选择/);
  await assert.rejects(saveMemoryRecallSettings(dataDir, { ...disabled, level1Enabled: 'false' }));
  assert.deepEqual(await loadMemoryRecallSettings(dataDir), disabled);
});

test('unconfigured or removed models fail before a model request instead of selecting a default', async t => {
  const dataDir = await fixture(t);
  const caller = async () => { throw new Error('unexpected request'); };
  await assert.rejects(callMemoryRecallModel(dataDir, input, {}, caller), /先选择/);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'a:chat' });
  await fs.writeFile(path.join(dataDir, 'providers.json'), '{"providers":[]}');
  await assert.rejects(callMemoryRecallModel(dataDir, input, {}, caller), /模型列表/);
});

test('recall output accepts only complete selections of supplied IDs, including a valid empty selection', async t => {
  const dataDir = await fixture(t);
  const invoke = (content: string, finishReason: 'stop' | 'length' = 'stop') =>
    callMemoryRecallModel(dataDir, input, { model: 'a:chat' }, async () => ({ content, finishReason }));
  for (const body of ['', '{}', '{"selectedIds":["invented"]}', '{"selectedIds":["language","language"]}',
    '{"selectedIds":[],"facts":"invented"}', '{"selectedIds":[1]}', 'plain answer']) await assert.rejects(invoke(body));
  await assert.rejects(invoke('{"selectedIds":["language"]}', 'length'));
  assert.deepEqual((await invoke('```json\n{"selectedIds":["language"]}\n```')).selectedIds, ['language']);
  assert.deepEqual((await invoke('{"selectedIds":[]}')).selectedIds, []);
});

test('recall input is bounded, forwards cancellation, and excludes unrelated caller fields', async t => {
  const dataDir = await fixture(t);
  for (const value of [{ ...input, query: 'x'.repeat(1201) }, { ...input, candidates: Array(21).fill(input.candidates[0]) },
    { ...input, candidates: [{ id: 'a', summary: 'x'.repeat(401) }] }]) {
    await assert.rejects(callMemoryRecallModel(dataDir, value, { model: 'a:chat' }));
  }
  const controller = new AbortController();
  await assert.rejects(callMemoryRecallModel(dataDir, input, { model: 'a:chat', signal: controller.signal }, async args => {
    assert.equal(args.signal, controller.signal);
    controller.abort(); return { content: '{"selectedIds":[]}', finishReason: 'stop' };
  }), /abort/i);
  const decorated = { ...input, privateData: 'omit-this' };
  await callMemoryRecallModel(dataDir, decorated, { model: 'a:chat' }, async args => {
    assert.doesNotMatch(JSON.stringify(args.messages), /omit-this/);
    assert.equal(args.purpose, 'memory-recall'); assert.equal(args.tools, undefined);
    return { content: '{"selectedIds":[]}', finishReason: 'stop' };
  });
});

test('manual verification uses the selected provider transport and requires the relevant sample result', async t => {
  const dataDir = await fixture(t);
  let answer = '{"selectedIds":["language"]}';
  const received: Record<string, unknown>[] = [];
  const provider = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    received.push(JSON.parse(body)); response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 140, completion_tokens: 12, total_tokens: 152 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => provider.close(() => resolve())));
  const address = provider.address(); assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'mock',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['recall'], providerType: 'openai-compatible',
    customRequestParameters: { max_tokens: 1000000 } }] }));
  const service = new MemoryRecallSettingsService(dataDir);
  const result = await service.test({ model: 'mock:recall' });
  assert.equal(result.model, 'mock:recall'); assert.equal(result.usage?.promptTokens, 140);
  assert.equal(received.length, 1); assert.equal(received[0].model, 'recall');
  assert.equal(received[0].max_tokens, 2048); assert.equal(received[0].tools, undefined);
  assert.equal((await service.read()).model, null);
  answer = '{"selectedIds":[]}';
  await assert.rejects(service.test({ model: 'mock:recall' }), /未通过/);
  assert.equal(received.length, 2);
});

test('manual search verification accepts read or preview passages and never saves configuration', async t => {
  const dataDir = await fixture(t);
  const received: Record<string, unknown>[] = [];
  const provider = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    received.push(JSON.parse(raw));
    const answer = received.length === 1
      ? '{"type":"tool_call","name":"recall_read","arguments":{"id":"language"}}'
      : JSON.stringify({ memories: [{ id: 'language', level: 'L2',
        text: '项目文档使用中文，保留必要英文术语。' }] });
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => provider.close(() => resolve())));
  const address = provider.address(); assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'mock',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['recall'] }] }));
  const service = new MemoryRecallSettingsService(dataDir);
  assert.deepEqual((await service.test({ model: 'mock:recall', kind: 'search' }) as { selectedIds: string[] }).selectedIds, ['language']);
  assert.equal(received.length, 2);
  assert.match(JSON.stringify(received[1]), /项目文档使用中文/);
  assert.deepEqual((await service.test({ model: 'mock:recall', kind: 'search' }) as { selectedIds: string[] }).selectedIds, ['language']);
  assert.equal(received.length, 3);
  assert.deepEqual(await service.read(), { version: 1, model: null });
  await assert.rejects(service.test({ model: 'mock:missing', kind: 'search' }), /模型列表/);
  assert.equal(received.length, 3);
});
