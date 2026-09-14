import assert from 'node:assert/strict';
import test from 'node:test';
import { InputOutbox } from './input-outbox';

test('pending inputs survive reload, retain IDs and do not overwrite another session or input', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const outbox = new InputOutbox(storage);
  const input = { agentId: 'a', sessionId: 's', runId: 'r', id: 'one', content: 'first' };
  outbox.put({ input, state: 'sending' });
  outbox.put({ input: { ...input, id: 'two', content: 'second' }, state: 'received' });
  outbox.put({ input: { ...input, sessionId: 'other' }, state: 'sending' });
  outbox.remove('s', 'one');
  assert.equal(new InputOutbox(storage).read('s')[0].input.id, 'two');
  assert.equal(outbox.read('other')[0].input.id, 'one');
});

test('corrupt local outbox is reported without overwriting it', () => {
  let writes = 0;
  const outbox = new InputOutbox({ getItem: () => '{broken', setItem: () => { writes++; }, removeItem: () => {} });
  assert.throws(() => outbox.read('session'));
  assert.equal(writes, 0);
});
