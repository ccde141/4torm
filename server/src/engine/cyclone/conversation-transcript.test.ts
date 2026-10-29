import assert from 'node:assert/strict';
import test from 'node:test';
import { alignCycloneTranscript, captureCycloneCompaction } from './conversation-transcript.js';

test('repeated Cyclone compactions keep the visible source once and never reintroduce retained model copies', () => {
  const request = { content: 'human direction' }, work = { content: 'tool evidence' };
  const summary = { content: 'summary' }, line = { content: 'boundary one' };
  const context = [summary, request];
  const first = captureCycloneCompaction(undefined, [request, work], context, line);
  const nextWork = { content: 'new tool evidence' };
  const second = captureCycloneCompaction(first, [...context, nextWork], [summary, request],
    { content: 'boundary two' });
  assert.deepEqual(second.messages.map(message => message.content),
    ['human direction', 'tool evidence', 'boundary one', 'new tool evidence', 'boundary two']);
  assert.equal(second.contextOffset, 2);
  assert.deepEqual(context, [summary, request]);
});

test('protocol-pair deletion adjusts the join and leaves newly generated work visible', () => {
  const paired = { content: 'call' }, result = { content: 'result' }, pinned = { content: 'human' };
  const generated = { content: 'new output' };
  const history = { messages: [{ content: 'old work' }], contextOffset: 3 };
  const before = [paired, result, pinned, generated];
  alignCycloneTranscript(history, before, [pinned, generated]);
  assert.equal(history.contextOffset, 1);
  const next = captureCycloneCompaction(history, [pinned, generated], [], { content: 'boundary' });
  assert.deepEqual(next.messages.map(message => message.content), ['old work', 'new output', 'boundary']);
});

test('an invalid display join cannot silently erase the source transcript', () => {
  assert.throws(() => captureCycloneCompaction({ messages: [], contextOffset: 9 }, [{ content: 'source' }], []),
    /原文未更改/);
});
