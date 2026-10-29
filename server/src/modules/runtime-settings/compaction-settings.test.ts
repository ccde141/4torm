import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaultCompactionPolicy, loadCompactionPolicy } from '../../engine/shared/compaction/index.js';
import { CompactionSettings } from './compaction-settings.js';

test('a changed fixed model is verified before settings are committed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-policy-'));
  const calls: string[] = [];
  try {
    const service = new CompactionSettings(dir, async model => {
      calls.push(model); if (model === 'p:offline') throw new Error('模型离线');
    });
    const policy = { ...defaultCompactionPolicy(), enabled: true,
      modelMode: 'fixed' as const, fixedModel: 'p:ok' };
    await service.write(policy);
    await service.write({ ...policy, prefixRatio: 0.5 });
    assert.deepEqual(calls, ['p:ok']);
    await assert.rejects(service.write({ ...policy, fixedModel: 'p:offline' }), /模型离线/);
    assert.equal((await loadCompactionPolicy(dir)).fixedModel, 'p:ok');
    await assert.rejects(service.test({ model: '' }), /模型/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('model verification uses the shared handoff prompt with a small verification body budget', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-policy-budget-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const received: number[] = [];
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const budget = payload.max_completion_tokens ?? payload.max_tokens;
    assert.match(payload.messages.at(-1).content, /目标与背景/);
    assert.match(payload.messages.at(-1).content, /压缩模型验证/);
    assert.match(payload.messages.at(-1).content, /正文上限为 512 token/);
    received.push(budget);
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ delta: {
      content: budget <= 8192 ? '资料已读取；校验待完成。' : '',
      reasoning_content: '核对记录中的事实和待办。',
    }, finish_reason: budget <= 8192 ? 'stop' : 'length' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => provider.close(() => resolve())));
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'budget', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['thinking'],
    transport: 'openai-chat-completions',
    customRequestParameters: { max_tokens: 512 },
  }] }));
  const service = new CompactionSettings(dir);
  assert.deepEqual(await service.test({ model: 'budget:thinking' }), { ok: true, model: 'budget:thinking' });
  assert.deepEqual(received, [2560]);
});

test('a local archive excerpt cannot report an empty capped model as successfully verified', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-policy-empty-cap-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://compaction-probe.test/v1', models: ['thinking'],
  }] }));
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('data: {"choices":[{"delta":{"reasoning_content":"思考中"},"finish_reason":"length"}]}\n\n'
      + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  await assert.rejects(new CompactionSettings(dataDir).test({ model: 'p:thinking' }), /仍未给出正文/);
  assert.equal(calls, 2);
  assert.equal((await loadCompactionPolicy(dataDir)).modelMode, 'current');
});
