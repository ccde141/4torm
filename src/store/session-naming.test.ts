import assert from 'node:assert/strict';
import test from 'node:test';
import { nameSessionOnce, TitleCompletion } from './session-naming.js';

test('仅正常 answer 和 done 允许命名，错误、中止、挂起或断流均不允许', () => {
  for (const sequence of [['done'], ['answer'], ['ask', 'done'], ['error', 'done'], ['answer', 'error', 'done']]) {
    const state = new TitleCompletion();
    sequence.forEach(type => state.observe(type));
    assert.equal(state.ready(false), false);
  }
  const state = new TitleCompletion();
  state.observe('answer'); state.observe('done');
  assert.equal(state.ready(false), true);
  assert.equal(state.ready(true), false);
});

test('命名只申请一次，迟到结果通过最新状态应用', async () => {
  let claimed = false;
  let calls = 0;
  let applied = '';
  const ports = {
    claim: async () => { if (claimed) return null; claimed = true; return { model: 'test', user: '问题', assistant: '回答' }; },
    generate: async () => { calls++; return '简短标题'; },
    apply: async (_id: string, title: string) => { applied = title; },
  };
  await Promise.all([nameSessionOnce('s', ports), nameSessionOnce('s', ports)]);
  assert.equal(calls, 1);
  assert.equal(applied, '简短标题');
});

test('命名失败真实抛出且不重试、不应用标题', async () => {
  let claimed = false;
  let calls = 0;
  const ports = {
    claim: async () => { if (claimed) return null; claimed = true; return { model: 'test', user: '问题', assistant: '回答' }; },
    generate: async (): Promise<string> => { calls++; throw new Error('provider failed'); },
    apply: async () => { assert.fail('must not apply'); },
  };
  await assert.rejects(nameSessionOnce('s', ports), /provider failed/);
  await nameSessionOnce('s', ports);
  assert.equal(calls, 1);
});
