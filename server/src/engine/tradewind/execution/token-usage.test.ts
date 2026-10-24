import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TokenUsageRecorder, captureTokenUsage, readTokenUsageFile } from './token-usage.js';
import { createModelRequestUsage, type ModelRequestUsage } from '../../shared/model-request-usage.js';

test('each reported call persists latest and confirmed total before delivery', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tw-usage-'));
  const file = path.join(dir, 'usage.json');
  try {
    const recorder = new TokenUsageRecorder(file);
    const first = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
    const second = { promptTokens: 13, completionTokens: 4, totalTokens: 17 };
    await recorder.record(first);
    assert.deepEqual(await readTokenUsageFile(file), {
      calls: 1, reportedCalls: 1, latest: first, total: first,
    });
    await recorder.record(second);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      calls: 2, reportedCalls: 2, latest: second,
      total: { promptTokens: 23, completionTokens: 6, totalTokens: 29 },
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing provider usage clears latest without inventing numbers', async () => {
  const recorder = new TokenUsageRecorder();
  await recorder.record({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  await recorder.record(null);
  assert.deepEqual(recorder.state, {
    calls: 2, reportedCalls: 1, latest: null,
    total: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
  });
});

test('old run without usage file is empty; corrupt sidecar is an error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tw-usage-'));
  const file = path.join(dir, 'usage.json');
  try {
    assert.equal(await readTokenUsageFile(file), undefined);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{broken');
    await assert.rejects(readTokenUsageFile(file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed model request records unknown before propagating the real error', async () => {
  const recorder = new TokenUsageRecorder();
  const known = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
  await captureTokenUsage(async () => ({ usage: known }), usage => recorder.record(usage));
  const failure = new Error('provider unavailable');
  await assert.rejects(captureTokenUsage(async () => { throw failure; },
    usage => recorder.record(usage)), error => error === failure);
  assert.equal(recorder.state.calls, 2);
  assert.equal(recorder.state.latest, null);
  assert.deepEqual(recorder.state.total, known);
});

test('请求快照按身份替换且失败保留流中已知量，压缩不替换主请求输入', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tw-request-usage-'));
  try {
    const file = path.join(dir, 'usage.json');
    const recorder = new TokenUsageRecorder(file);
    const request: ModelRequestUsage = { id: 'main', purpose: 'conversation', state: 'sent',
      startedAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z',
      estimatedInputTokens: 120, imageCount: 0, usageComplete: false };
    await recorder.recordRequest(request);
    const partial = { ...request, state: 'streaming' as const,
      usage: { promptTokens: 130, completionTokens: 9, totalTokens: 139 } };
    await recorder.recordRequest(partial);
    await recorder.recordRequest(partial);
    await recorder.recordRequest({ ...partial, state: 'failed' });
    await recorder.recordRequest({ ...request, id: 'compact', purpose: 'compaction', state: 'completed',
      startedAt: '2026-10-24T00:00:01Z', usage: { promptTokens: 30, completionTokens: 4, totalTokens: 34 },
      usageComplete: true });
    await recorder.record(null);
    const saved = await readTokenUsageFile(file);
    assert.equal(saved?.modelUsage?.calls, 2);
    assert.equal(saved?.modelUsage?.total.totalTokens, 173);
    assert.equal(saved?.modelUsage?.latest?.id, 'main');
    assert.equal(saved?.modelUsage?.complete, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('直接会议调用也能在响应失败前持久化预计请求', async () => {
  const recorder = new TokenUsageRecorder();
  await assert.rejects(captureTokenUsage(async () => {
    const request = createModelRequestUsage({ messages: [{ role: 'user', content: '检查当前资料' }] });
    request.update({ state: 'sent', wasSent: true });
    request.finish('failed');
    throw new Error('fixture failure');
  }, usage => recorder.record(usage), event => {
    void recorder.recordRequest(event.request).catch(() => {});
  }), /fixture failure/);
  await recorder.flush();
  assert.equal(recorder.state.modelUsage?.calls, 1);
  assert.ok(recorder.state.modelUsage?.latest?.estimatedInputTokens);
  assert.equal(recorder.state.modelUsage?.latest?.state, 'failed');
  assert.equal(recorder.state.modelUsage?.total.totalTokens, 0);
});
