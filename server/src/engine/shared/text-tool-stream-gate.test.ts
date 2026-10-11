import assert from 'node:assert/strict';
import test from 'node:test';
import { TextToolStreamGate } from './text-tool-stream-gate.js';

test('json fenced tool calls stay hidden until the text loop classifies them', () => {
  const chunks: string[] = [];
  const gate = new TextToolStreamGate(chunk => chunks.push(chunk));
  gate.push('```js');
  gate.push('on\n{"type":"tool_call",');
  gate.push('"name":"ping","arguments":{}}\n```');
  assert.deepEqual(chunks, []);
  gate.finish(false);
  assert.deepEqual(chunks, []);
});

test('ordinary fenced JSON answers remain visible', () => {
  const chunks: string[] = [];
  const gate = new TextToolStreamGate(chunk => chunks.push(chunk));
  const answer = '```json\n{"status":"ok"}\n```';
  gate.push(answer);
  gate.finish(true);
  assert.equal(chunks.join(''), answer);
});
