import assert from 'node:assert/strict';
import test from 'node:test';
import { readMonsoonEvents } from './sse-events';

function chunks(...parts: string[]): ReadableStream<Uint8Array> {
  const bytes = parts.map(part => new TextEncoder().encode(part));
  return new ReadableStream({
    start(controller) { for (const part of bytes) controller.enqueue(part); controller.close(); },
  });
}

test('parses comments, split frames and an unterminated final line in order', async () => {
  const stream = chunks(': connected\r\n\r\ndata: {"type":"tok',
    'en","content":"你"}\r\n\r\ndata: {"type":"done"}');
  const events = [];
  for await (const event of readMonsoonEvents(stream)) events.push(event);
  assert.deepEqual(events, [
    { type: 'token', content: '你' }, { type: 'done' },
  ]);
});

test('missing body and malformed event are explicit protocol errors', async () => {
  await assert.rejects(async () => {
    for await (const _ of readMonsoonEvents(null)) { /* consume */ }
  }, /响应体/);
  await assert.rejects(async () => {
    for await (const _ of readMonsoonEvents(chunks('data: {oops}\n\n'))) { /* consume */ }
  }, /SSE.*JSON/);
});

test('keeps a UTF-8 character intact across transport chunks', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"token","content":"猫"}\n\n');
  const split = bytes.indexOf(0xe7) + 1;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readMonsoonEvents(body)) events.push(event);
  assert.deepEqual(events, [{ type: 'token', content: '猫' }]);
});

test('a malformed frame after done is still observed, not treated as success', async () => {
  const events = [];
  await assert.rejects(async () => {
    for await (const event of readMonsoonEvents(chunks(
      'data: {"type":"done"}\n\ndata: {bad}\n\n',
    ))) events.push(event);
  }, /SSE.*JSON/);
  assert.deepEqual(events, [{ type: 'done' }]);
});
