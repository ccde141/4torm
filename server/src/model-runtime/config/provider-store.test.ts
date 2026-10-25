import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { modelRuntimeRoutes } from '../../routes/model-runtime.js';
import {
  createProvider, findProvider, patchProvider, publicConfiguration, readProviderDocument,
} from './provider-store.js';

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('per-model response waits survive storage and public configuration without changing other models', async t => {
  const dataDir = await fixture(t);
  const provider = await createProvider(dataDir, { label: 'Local', baseUrl: 'http://127.0.0.1:8080/v1', models: ['a', 'b'] });
  await patchProvider(dataDir, provider.id, { modelResponseWaitMinutes: { a: 180, b: 30 } });
  await patchProvider(dataDir, provider.id, { label: 'Renamed' });
  assert.deepEqual((await findProvider(dataDir, provider.id)).modelResponseWaitMinutes, { a: 180, b: 30 });
  assert.deepEqual((await publicConfiguration(dataDir)).providers[0].modelResponseWaitMinutes, { a: 180, b: 30 });
  await assert.rejects(patchProvider(dataDir, provider.id, { modelResponseWaitMinutes: { a: 0 } }));
  assert.deepEqual((await findProvider(dataDir, provider.id)).modelResponseWaitMinutes, { a: 180, b: 30 });
});

test('configuration APIs redact credentials while edits retain omitted values and can explicitly clear them', async t => {
  const dataDir = await fixture(t);
  const app = Fastify();
  app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/api/model-runtime/configuration/providers', payload: {
    label: 'Local runtime', baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'private-key',
    customHeaders: { 'x-api-key': 'header-secret' }, models: ['local-model'],
  } });
  assert.equal(created.statusCode, 200);
  assert.equal(created.headers['cache-control'], 'no-store');
  const provider = created.json();
  assert.equal(provider.apiKey, ''); assert.equal(provider.hasApiKey, true);
  assert.deepEqual(provider.customHeaders, { 'x-api-key': '' });
  assert.deepEqual(provider.configuredHeaderNames, ['x-api-key']);
  assert.ok(!created.body.includes('private-key') && !created.body.includes('header-secret'));
  const edited = await app.inject({ method: 'PATCH',
    url: `/api/model-runtime/configuration/providers/${provider.id}`, payload: { label: 'Renamed' } });
  assert.equal(edited.statusCode, 200);
  let stored = await findProvider(dataDir, provider.id);
  assert.equal(stored.apiKey, 'private-key'); assert.equal(stored.customHeaders?.['x-api-key'], 'header-secret');
  const listed = await app.inject({ method: 'GET', url: '/api/model-runtime/configuration' });
  assert.ok(!listed.body.includes('private-key') && !listed.body.includes('header-secret'));
  const active = await app.inject({ method: 'PUT', url: '/api/model-runtime/configuration/active-model',
    payload: { model: `${provider.id}:local-model` } });
  assert.equal(active.statusCode, 200);
  await patchProvider(dataDir, provider.id, { apiKey: '', customHeaders: {} });
  stored = await findProvider(dataDir, provider.id);
  assert.equal(stored.apiKey, ''); assert.deepEqual(stored.customHeaders, {});
  const deleted = await app.inject({ method: 'DELETE', url: `/api/model-runtime/configuration/providers/${provider.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(await publicConfiguration(dataDir), { providers: [], activeModel: '' });
});

test('serialized configuration transactions preserve concurrent edits and unknown legacy fields', async t => {
  const dataDir = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ documentExtension: { keep: true },
    providers: [{ id: 'legacy', baseUrl: 'http://127.0.0.1:8080/v1', models: [], apiKey: 'keep',
      providerExtension: { keep: true }, legacyOptionalExtension: null }] }));
  await Promise.all([
    patchProvider(dataDir, 'legacy', { label: 'Concurrent edit' }),
    patchProvider(dataDir, 'legacy', { models: ['new-model'] }),
    createProvider(dataDir, { label: 'Second provider', baseUrl: 'https://provider.test/v1' }),
  ]);
  const document = await readProviderDocument(dataDir);
  assert.deepEqual(document.documentExtension, { keep: true });
  assert.equal(document.providers.length, 2);
  const legacy = await findProvider(dataDir, 'legacy');
  assert.equal(legacy.label, 'Concurrent edit'); assert.deepEqual(legacy.models, ['new-model']);
  assert.equal(legacy.apiKey, 'keep'); assert.deepEqual(legacy.providerExtension, { keep: true });
  assert.equal(legacy.legacyOptionalExtension, null);
  assert.equal((await publicConfiguration(dataDir)).providers[0].providerExtension, undefined);
  assert.deepEqual((await fs.readdir(dataDir)).filter(name => name.endsWith('.tmp')), []);
});

test('explicit null clears optional settings without clearing required values or credentials', async t => {
  const dataDir = await fixture(t);
  const configured = await createProvider(dataDir, { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'keep',
    runtimePolicy: { maxConcurrency: 2 }, generationDefaults: { temperature: 0.4 } });
  await patchProvider(dataDir, configured.id, { runtimePolicy: null, generationDefaults: null });
  const stored = await findProvider(dataDir, configured.id);
  assert.equal(stored.runtimePolicy, undefined); assert.equal(stored.generationDefaults, undefined);
  assert.equal(stored.apiKey, 'keep');
  await assert.rejects(patchProvider(dataDir, configured.id, { apiKey: null }),
    { code: 'PROVIDER_CONFIGURATION_INPUT_INVALID' });
});

test('a custom compatible provider can start as an empty-address draft and be configured later', async t => {
  const dataDir = await fixture(t);
  const configured = await createProvider(dataDir, { label: 'OpenAI Compatible', baseUrl: '', apiKey: '', models: [],
    providerType: 'openai-compatible', transport: 'openai-chat-completions' });
  assert.equal(configured.baseUrl, '');
  await patchProvider(dataDir, configured.id, { label: 'Local runtime' });
  assert.equal((await findProvider(dataDir, configured.id)).baseUrl, '');
  await patchProvider(dataDir, configured.id, { baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.equal((await findProvider(dataDir, configured.id)).baseUrl, 'http://127.0.0.1:8080/v1');
});

test('DeepSeek writes reject excessive output budgets without changing persisted configuration', async t => {
  const dataDir = await fixture(t);
  await assert.rejects(createProvider(dataDir, { baseUrl: 'https://api.deepseek.com/v1',
    providerType: 'deepseek', generationDefaults: { maxOutputTokens: 1_000_000 } }),
  { statusCode: 400, code: 'PROVIDER_CONFIGURATION_INPUT_INVALID' });
  const provider = await createProvider(dataDir, { baseUrl: 'https://api.deepseek.com/v1',
    providerType: 'deepseek', generationDefaults: { maxOutputTokens: 393_216 } });
  const before = await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8');
  await assert.rejects(patchProvider(dataDir, provider.id, { generationDefaults: { maxOutputTokens: 393_217 } }),
    /maxOutputTokens.*393216/);
  assert.equal(await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8'), before);
});

test('legacy DeepSeek settings remain readable and unrelated edits do not rewrite their output budget', async t => {
  const dataDir = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'legacy-deepseek', baseUrl: 'https://api.deepseek.com/v1', providerType: 'deepseek',
    generationDefaults: { maxOutputTokens: 1_000_000 },
  }] }));
  await patchProvider(dataDir, 'legacy-deepseek', { label: 'Renamed provider' });
  const provider = await findProvider(dataDir, 'legacy-deepseek');
  assert.equal(provider.generationDefaults?.maxOutputTokens, 1_000_000);
  await patchProvider(dataDir, 'legacy-deepseek', { generationDefaults: { maxOutputTokens: 393_216 } });
  assert.equal((await findProvider(dataDir, 'legacy-deepseek')).generationDefaults?.maxOutputTokens, 393_216);
  await createProvider(dataDir, { baseUrl: 'http://localhost:8080/v1', providerType: 'openai-compatible',
    generationDefaults: { maxOutputTokens: 1_000_000 } });
});

test('malformed or interrupted provider storage is never replaced with an empty configuration', async t => {
  const dataDir = await fixture(t);
  const file = path.join(dataDir, 'providers.json');
  await fs.writeFile(file, '{broken-private-data');
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(publicConfiguration(dataDir), { code: 'PROVIDER_CONFIGURATION_CORRUPT' });
    await assert.rejects(createProvider(dataDir, { baseUrl: 'https://provider.test/v1' }),
      { code: 'PROVIDER_CONFIGURATION_CORRUPT' });
    assert.equal(await fs.readFile(file, 'utf8'), '{broken-private-data');
  }
  await fs.rm(file); await fs.mkdir(file);
  await assert.rejects(createProvider(dataDir, { baseUrl: 'https://provider.test/v1' }),
    { code: 'PROVIDER_CONFIGURATION_CORRUPT' });
  assert.equal((await fs.stat(file)).isDirectory(), true);
});

test('configuration rejects injected fields, unsafe addresses and malformed headers before writing', async t => {
  const dataDir = await fixture(t);
  for (const value of [{ baseUrl: 'file:///etc/passwd' }, { baseUrl: 'https://user:secret@provider.test/v1' },
    { baseUrl: 'https://provider.test/v1', apiKey: 'key\r\nInjected: true' },
    { baseUrl: 'https://provider.test/v1', customHeaders: { 'bad\nname': 'secret' } },
    { baseUrl: 'https://provider.test/v1', id: 'injected' },
    { baseUrl: 'https://provider.test/v1', providerType: 'missing' }]) {
    await assert.rejects(createProvider(dataDir, value), { code: 'PROVIDER_CONFIGURATION_INPUT_INVALID' });
  }
  assert.deepEqual(await fs.readdir(dataDir), []);
});
