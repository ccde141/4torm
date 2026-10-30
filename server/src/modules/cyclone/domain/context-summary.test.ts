import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { retainedCyclonePrivateMessages } from './context-summary.js';

test('private display retains selected human directions without restoring compressed tools or public observations', () => {
  const human: ContextMessage = { role: 'user', content: '继续核验当前目标' };
  const old: ContextMessage = { role: 'assistant', content: '已完成的旧工具过程' };
  const recent: ContextMessage = { role: 'assistant', content: '最近进度' };
  const messages = [human, old, recent];
  const context: ContextMessage[] = [{ role: 'user', content: '[公共会议：人类] 公共目标' }, ...messages];
  assert.deepEqual(retainedCyclonePrivateMessages(messages, context,
    { summary: '旧过程已核验', retainedIndexes: [0, 1, 3] }), [human, recent]);
});

test('matching private records preserve occurrence identity when identical human messages repeat', () => {
  const old: ContextMessage = { role: 'user', content: '继续' };
  const recent: ContextMessage = { role: 'user', content: '继续' };
  const result = retainedCyclonePrivateMessages([old, recent], [old, recent],
    { summary: '旧过程', retainedIndexes: [1] });
  assert.equal(result.length, 1);
  assert.equal(result[0], recent);
});

test('an earlier retained human direction survives gaps already removed by a previous automatic compaction', () => {
  const human: ContextMessage = { role: 'user', content: '保留原始方向', origin: 'human' };
  const old: ContextMessage = { role: 'assistant', content: '已经压缩的长工具过程' };
  const latestHuman: ContextMessage = { role: 'user', content: '继续', origin: 'human' };
  const latest: ContextMessage = { role: 'assistant', content: '当前进度' };
  const context: ContextMessage[] = [{ role: 'system', content: '之前摘要' }, human, latestHuman, latest];
  assert.deepEqual(retainedCyclonePrivateMessages([human, old, latestHuman, latest], context,
    { summary: '本次摘要', retainedIndexes: [1, 2, 3] }), [human, latestHuman, latest]);
});

test('origin and duplicate occurrence identity survive missing private records between retained directions', () => {
  const oldHuman: ContextMessage = { role: 'user', content: '继续', origin: 'human' };
  const notice: ContextMessage = { role: 'user', content: '继续', origin: 'framework' };
  const old: ContextMessage = { role: 'assistant', content: '先前工作' };
  const latestHuman: ContextMessage = { role: 'user', content: '继续', origin: 'human' };
  const context = [oldHuman, notice, latestHuman];
  const result = retainedCyclonePrivateMessages([oldHuman, notice, old, latestHuman], context,
    { summary: '本次摘要', retainedIndexes: [0, 2] });
  assert.equal(result.length, 2);
  assert.equal(result[0], oldHuman);
  assert.equal(result[1], latestHuman);
});
