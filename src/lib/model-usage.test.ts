import assert from 'node:assert/strict';
import test from 'node:test';
import { applyModelRequest, formatCurrentInput, formatModelUsage, mergeModelUsage, type ModelRequestUsage } from './model-usage';

const request = (id: string, change: Partial<ModelRequestUsage> = {}): ModelRequestUsage => ({
  id, purpose: 'conversation', state: 'prepared', startedAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.001Z', estimatedInputTokens: 2400, imageCount: 0,
  usageComplete: false, ...change,
});
test('initial and follow-up inputs display current estimates instead of unknown or old counts', () => {
  const first = applyModelRequest(undefined, request('one'));
  assert.equal(formatModelUsage(first, 'zh-CN')?.label, '2.4K');
  const reported = applyModelRequest(first, request('one', { state: 'completed',
    updatedAt: '2026-10-24T00:00:00.002Z', usageComplete: true,
    usage: { promptTokens: 2500, completionTokens: 20, totalTokens: 2520 } }));
  assert.equal(formatModelUsage(reported, 'zh-CN')?.label, '2.5K');
  const next = applyModelRequest(reported, request('two', { estimatedInputTokens: 3000 }));
  assert.equal(formatModelUsage(next, 'zh-CN')?.label, '3.0K');
  assert.equal(next.total.totalTokens, 2520);
  assert.equal(mergeModelUsage(next, first)?.latest?.id, 'two');
  assert.equal(applyModelRequest(reported, request('one')), reported);
});
test('compaction contributes known totals without replacing main-conversation context display', () => {
  const first = applyModelRequest(undefined, request('main'));
  const next = applyModelRequest(first, request('summary', { purpose: 'compaction',
    state: 'completed', usageComplete: true,
    usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }));
  assert.equal(next.total.totalTokens, 25);
  assert.equal(next.latest?.id, 'main');
  assert.match(formatModelUsage(next, 'en-US')!.title, /Estimated input/);
  const summaryOnly = applyModelRequest(undefined, request('summary', { purpose: 'compaction',
    state: 'failed', usage: { promptTokens: 15, completionTokens: 2, totalTokens: 17 } }));
  assert.equal(formatModelUsage(summaryOnly, 'zh-CN', { promptTokens: 1200, completionTokens: 0, totalTokens: 1200 })?.label, '1.2K');
  assert.equal(formatModelUsage(summaryOnly, 'zh-CN'), undefined);
  assert.match(formatCurrentInput({ tokens: 1200, images: 0, model: 'fixture',
    estimatedAt: '2026-10-24T01:00:00.000Z' }, 'zh-CN', summaryOnly)!.title, /17 token/);
});

test('current context preview can decrease after an edit without changing actual billing', () => {
  const progress = applyModelRequest(undefined, request('done', { state: 'completed', usageComplete: true,
    usage: { promptTokens: 9000, completionTokens: 1000, totalTokens: 10000 } }));
  const snapshot = JSON.stringify(progress);
  const estimate = { tokens: 12000, images: 0, model: 'fixture', estimatedAt: '2026-10-24T01:00:00.000Z' };
  assert.equal(formatCurrentInput(estimate, 'zh-CN', progress)?.label, '12.0K');
  assert.equal(formatCurrentInput({ ...estimate, tokens: 400 }, 'zh-CN', progress)?.label, '400');
  assert.equal(JSON.stringify(progress), snapshot);
  assert.equal(formatCurrentInput(undefined, 'zh-CN'), undefined);
});

test('a running context observation remains authoritative while its request reports usage', () => {
  const progress = applyModelRequest(undefined, request('live', { state: 'completed', usageComplete: true,
    usage: { promptTokens: 174243, completionTokens: 643, totalTokens: 174886 } }));
  const live = { tokens: 185150, images: 0, model: 'fixture', active: true, runId: 'run-one',
    contextRevision: 'run-one:10', estimatedAt: '2026-10-23T23:00:00.000Z' };
  assert.equal(formatCurrentInput(live, 'zh-CN', progress)?.label, '185.2K');
  assert.equal(formatCurrentInput({ ...live, tokens: 40000, contextRevision: 'run-one:11' }, 'zh-CN', progress)?.label, '40.0K');
});

test('a new request temporarily supersedes an older context preview until a fresh context read', () => {
  const progress = applyModelRequest(undefined, request('live'));
  const estimate = { tokens: 100, images: 0, model: 'fixture', estimatedAt: '2026-10-23T23:00:00.000Z' };
  assert.equal(formatCurrentInput(estimate, 'zh-CN', progress)?.label, '2.4K');
  const finished = applyModelRequest(progress, request('live', { state: 'completed', usageComplete: true,
    usage: { promptTokens: 2500, completionTokens: 500, totalTokens: 3000 } }));
  assert.equal(formatCurrentInput({ ...estimate, tokens: 3100, estimatedAt: '2026-10-24T01:00:00.000Z' }, 'zh-CN', finished)?.label, '3.1K');
  assert.equal(formatCurrentInput({ ...estimate, tokens: 3100, estimatedAt: '2026-10-24T01:00:00.000Z' }, 'zh-CN', progress)?.label, '3.1K');
});
