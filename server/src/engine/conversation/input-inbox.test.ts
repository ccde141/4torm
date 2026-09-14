import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationInputInbox, type InputReceipt } from './input-inbox.js';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

test('input becomes consumable only after successful persistence; concurrent submissions retain order', async () => {
  const block = gate();
  const saved: InputReceipt[] = [];
  const inbox = new ConversationInputInbox('run-1', async receipt => {
    await block.wait;
    saved.push(receipt);
  });
  const first = inbox.submit({ id: 'input-1', content: 'first' });
  const second = inbox.submit({ id: 'input-2', content: 'second' });
  assert.equal(inbox.hasPending(), false);
  assert.deepEqual(inbox.drain(), []);
  block.release();
  const receipts = await Promise.all([first, second]);
  assert.deepEqual(saved.map(value => value.sequence), [1, 2]);
  assert.deepEqual(receipts.map(value => value.runId), ['run-1', 'run-1']);
  assert.deepEqual(inbox.drain(), receipts);
  assert.deepEqual(inbox.drain(), []);
});

test('identical concurrent IDs persist once, differing content conflicts without overwriting', async () => {
  let writes = 0;
  const inbox = new ConversationInputInbox('run-1', async () => { writes++; });
  const message = { id: 'input-1', content: 'unchanged' };
  const results = await Promise.all([inbox.submit(message), inbox.submit(message)]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(inbox.submit({ ...message, content: 'different' }), /INPUT_ID_CONFLICT/);
  inbox.drain();
  assert.deepEqual(await inbox.submit(message), results[0]);
  assert.equal(inbox.hasPending(), false);
  assert.equal(writes, 1);
});

test('closing fences new input immediately and waits for already accepted writes', async () => {
  const block = gate();
  const inbox = new ConversationInputInbox('run-1', async () => block.wait);
  const submitted = inbox.submit({ id: 'input-1', content: 'arriving at end' });
  const closing = inbox.close();
  await assert.rejects(inbox.submit({ id: 'input-2', content: 'too late' }), /INPUT_RUN_CLOSED/);
  block.release();
  const receipt = await submitted;
  assert.deepEqual(await closing, [receipt]);
  assert.equal(inbox.hasPending(), false);
  assert.deepEqual(inbox.drain(), []);
  assert.deepEqual(await inbox.close(), [receipt]);
  assert.deepEqual(await inbox.submit({ id: 'input-1', content: receipt.content }), receipt);
});

test('write failure is not acknowledged, retried, or hidden by closing', async () => {
  const failure = new Error('disk full');
  let writes = 0;
  const inbox = new ConversationInputInbox('run-1', async () => { writes++; throw failure; });
  await assert.rejects(inbox.submit({ id: 'input-1', content: 'preserve' }), error => error === failure);
  assert.deepEqual(inbox.drain(), []);
  await assert.rejects(inbox.close(), error => error === failure);
  assert.equal(writes, 1);
});

test('different runs do not share messages or deduplication', async () => {
  const a = new ConversationInputInbox('run-a', async () => {});
  const b = new ConversationInputInbox('run-b', async () => {});
  await a.submit({ id: 'same', content: 'A' });
  await b.submit({ id: 'same', content: 'B' });
  assert.deepEqual(a.drain().map(value => value.content), ['A']);
  assert.deepEqual(b.drain().map(value => value.content), ['B']);
});

test('queue is bounded and malformed input is rejected before persistence', async () => {
  let writes = 0;
  const inbox = new ConversationInputInbox('run-1', async () => { writes++; }, { pending: 2, total: 3 });
  for (const input of [null, {}, { id: 1, content: 'x' }, { id: '../x', content: 'x' },
    { id: 'x', content: ' ' }, { id: 'x', content: 'x', role: 'system' }]) {
    await assert.rejects(inbox.submit(input), /INPUT_INVALID/);
  }
  await inbox.submit({ id: '1', content: 'one' });
  await inbox.submit({ id: '2', content: 'two' });
  await assert.rejects(inbox.submit({ id: '3', content: 'three' }), /INPUT_QUEUE_FULL/);
  inbox.drain();
  await inbox.submit({ id: '3', content: 'three' });
  inbox.drain();
  await assert.rejects(inbox.submit({ id: '4', content: 'four' }), /INPUT_RUN_LIMIT/);
  assert.equal(writes, 3);
});

test('returned objects cannot mutate stored input or close results', async () => {
  const inbox = new ConversationInputInbox('run-1', async () => {});
  const receipt = await inbox.submit({ id: 'input-1', content: 'original' });
  receipt.content = 'mutated';
  const remaining = await inbox.close();
  assert.equal(remaining[0].content, 'original');
  remaining[0].content = 'mutated again';
  assert.equal((await inbox.close())[0].content, 'original');
});
