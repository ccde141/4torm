import assert from 'node:assert/strict';
import test from 'node:test';
import { needsReflection, reflectionSnapshot } from './reflection.js';

test('cheap reflection decisions distinguish unchanged topics, new sources, semantic changes and compaction', () => {
  const previous = { query: '气旋卡片', candidates: ['memory:a:v1'], compact: '', vector: [1, 0] };
  assert.equal(needsReflection(undefined, previous), true);
  assert.equal(needsReflection(previous, { ...previous, query: '调整气旋卡片' }), false);
  assert.equal(needsReflection(previous, { ...previous, query: '继续', candidates: [] }), false);
  assert.equal(needsReflection(previous, { ...previous, candidates: ['memory:b:v1'] }), true);
  assert.equal(needsReflection(previous, { ...previous, candidates: ['memory:a:v2'] }), true);
  assert.equal(needsReflection(previous, { ...previous, vector: [0, 1] }), true);
  const next = reflectionSnapshot('继续', [{ role: 'system', content: '[历史压缩记录]\n阶段交接' }], { records: [], scores: {} });
  assert.equal(needsReflection(previous, next), true);
});
