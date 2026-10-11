import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { BoundedSseWriter } from './bounded-sse.js';

class FakeResponse extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  writable = false;
  frames: string[] = [];
  write(frame: string): boolean { this.frames.push(frame); return this.writable; }
  end(): void { this.writableEnded = true; }
  destroy(): void { this.destroyed = true; this.emit('close'); }
}

test('a slow connection buffers bounded frames and drains them in order before ending', () => {
  const raw = new FakeResponse();
  const writer = new BoundedSseWriter(raw, 1024, () => assert.fail('unexpected overflow'));
  writer.send({ type: 'token', content: 'one' });
  writer.send({ type: 'token', content: 'two' });
  writer.send({ type: 'done' });
  writer.finish();
  assert.equal(raw.frames.length, 1);
  assert.equal(raw.writableEnded, false);
  raw.writable = true;
  raw.emit('drain');
  assert.deepEqual(raw.frames.map(frame => JSON.parse(frame.slice(6).trim()).type),
    ['token', 'token', 'done']);
  assert.equal(raw.writableEnded, true);
});

test('overflow aborts the producer and closes the slow connection once', () => {
  const raw = new FakeResponse();
  let aborted = 0;
  const writer = new BoundedSseWriter(raw, 100, () => { aborted++; });
  writer.send({ type: 'token', content: 'first' });
  writer.send({ type: 'token', content: 'x'.repeat(200) });
  writer.send({ type: 'done' });
  assert.equal(aborted, 1);
  assert.equal(raw.destroyed, true);
  assert.equal(raw.frames.length, 1);
});

test('disconnect discards unsent frames and cannot resurrect the stream on drain', () => {
  const raw = new FakeResponse();
  const writer = new BoundedSseWriter(raw, 1024, () => {});
  writer.send({ type: 'token', content: 'one' });
  writer.send({ type: 'token', content: 'two' });
  raw.emit('close');
  raw.emit('drain');
  assert.equal(raw.frames.length, 1);
});
