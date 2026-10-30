import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { compactMessages } from './controller.js';
import { defaultCompactionPolicy } from './policy.js';
import { serializeCompactionMessages } from './estimate.js';

const options = { dataDir: '', area: 'monsoon' as const, kind: 'conversation' as const,
  model: 'fixture:model', mode: 'full' as const, reason: 'manual' as const,
  policy: defaultCompactionPolicy(), protectedPrefixCount: 1,
  resolveSummaryBudget: async () => 200_000, summarize: async () => 'Verified earlier work.' };

function rounds(count: number): ContextMessage[] {
  return [{ role: 'system', content: 'Rules' }, ...Array.from({ length: count }, (_, index) => [
    { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
    { role: 'assistant' as const, content: `Work ${index} `.repeat(100) },
    { role: 'user' as const, origin: 'framework' as const, content: `Internal report ${index}` },
  ]).flat()];
}

test('summary source distinguishes human direction from injected framework reports', () => {
  const source = serializeCompactionMessages([
    { role: 'user', origin: 'human', content: 'Verify before writing' },
    { role: 'user', origin: 'framework', content: 'The worker has reported progress' },
  ]);
  assert.match(source, /\[user 人类输入\]\nVerify before writing/);
  assert.match(source, /\[user 框架消息\]\nThe worker has reported progress/);
});

test('private compaction keeps four complete human-led turns outside the summary source', async () => {
  const messages = rounds(6), recent = messages.slice(7);
  const plan = await compactMessages({ ...options, messages, summarize: async input => {
    assert.match(input.text, /Direction 1/);
    assert.doesNotMatch(input.text, /Direction 2|Internal report 2/);
    return 'Verified earlier work.';
  } });
  assert.equal(plan?.prefix.length, 6);
  assert.deepEqual(messages.slice(2), recent);
  assert.ok(recent.every(message => messages.includes(message)), 'original tail identities survive');
  messages.push({ role: 'user', origin: 'human', content: 'Direction 6' }, { role: 'assistant', content: 'New work' });
  await compactMessages({ ...options, messages });
  assert.deepEqual(messages.filter(message => message.origin === 'human').map(message => message.content),
    ['Direction 3', 'Direction 4', 'Direction 5', 'Direction 6']);
  assert.ok(messages.some(message => message.content.startsWith('Work 3')));
});

test('public group history keeps three human-led rounds with all participating replies', async () => {
  const messages = rounds(5), recent = messages.slice(7);
  await compactMessages({ ...options, kind: 'meeting', chairModel: 'fixture:model', messages });
  assert.deepEqual(messages.slice(2), recent);
  assert.equal(messages.filter(message => message.origin === 'human').length, 3);
  assert.equal(messages.filter(message => message.origin === 'framework').length, 3);
});

test('fewer human turns retain their direction and recent complete native pairs within the allowance', async () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'Rules' },
    { role: 'user', origin: 'human', content: 'Do the task' },
    { role: 'assistant', toolCalls: [{ id: 'old', name: 'read', arguments: '{}' }], content: '' },
    { role: 'tool', content: '旧'.repeat(40_000), toolCallId: 'old' },
    { role: 'assistant', toolCalls: [{ id: 'new', name: 'read', arguments: '{}' }], content: '' },
    { role: 'tool', content: '新'.repeat(28_000), toolCallId: 'new' }];
  const recent = [messages[1], ...messages.slice(4)];
  const plan = await compactMessages({ ...options, messages });
  assert.deepEqual(plan?.tail, recent);
  assert.deepEqual(messages.slice(2), recent);
});

test('four human directions remain exact without protecting their oversized tool and reply history', async () => {
  const messages = rounds(5);
  messages.at(-2)!.content = '近'.repeat(40_000);
  const humans = messages.filter(message => message.origin === 'human').slice(-4);
  const lastReport = messages.at(-1)!;
  await compactMessages({ ...options, messages });
  assert.deepEqual(messages.slice(2), [...humans, lastReport]);
  assert.ok(humans.every(message => messages.includes(message)));
  assert.ok(!messages.some(message => message.content === '近'.repeat(40_000)));
});

test('short protected history neither invokes the model nor creates a committed marker', async () => {
  const messages = rounds(2), original = structuredClone(messages);
  assert.equal(await compactMessages({ ...options, messages,
    summarize: async () => assert.fail('all recent history is protected'),
    commit: async () => assert.fail('there is no compaction to commit') }), null);
  assert.deepEqual(messages, original);
});

test('a failed durable commit preserves every original record', async () => {
  const messages = rounds(6), original = structuredClone(messages);
  await assert.rejects(compactMessages({ ...options, messages,
    commit: async () => { throw new Error('fixture interrupted write'); } }), /interrupted write/);
  assert.deepEqual(messages, original);
});
