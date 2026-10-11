import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const convectionNative = fs.readFileSync(
  new URL('../../../modules/convection/execution/native-adapter.ts', import.meta.url),
  'utf8',
);
const tradewindNode = fs.readFileSync(
  new URL('../../tradewind/execution/node-runner.ts', import.meta.url),
  'utf8',
);
const tradewindMeeting = fs.readFileSync(
  new URL('../../tradewind/execution/meeting-handlers.ts', import.meta.url),
  'utf8',
);

test('feature adapters preserve reasoning callbacks on native and text paths', () => {
  assert.match(convectionNative, /callModel: \(msgs, opts, onChunk, sig, tools, onReasoning\)/);
  assert.match(convectionNative, /params\.llm\.call\(msgs, opts, onChunk, sig, tools, onReasoning\)/);
  assert.match(convectionNative, /callLLM\([\s\S]*onReasoning,/);
  assert.match(convectionNative, /onEvent\(\{ \.\.\.ev, label \}\)/);

  assert.match(tradewindNode, /async call\(msgs, _options, onChunk, sig, onReasoning\)/);
  assert.match(tradewindNode, /onReasoning,/);
});

test('Tradewind text paths retain virtual tools and configured temperature', () => {
  assert.match(tradewindNode, /tools: toolCaller,/);
  assert.doesNotMatch(tradewindNode, /tools: toolDefs\.length > 0 \? toolCaller : undefined/);
  assert.match(tradewindMeeting, /options: \{ temperature: agent\.temperature \?\? 0\.7 \}/);
});
