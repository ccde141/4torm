import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { projectNodeHistory } from './node-history-view.js';

const source = fs.readFileSync('src/engine/tradewind/execution/node-runner.ts', 'utf8');

test('NodeRunner 文本路径转发独立 reasoning 事件', () => {
  assert.match(source, /ev\.type === 'reasoning'[\s\S]*emit\(\{ type: 'reasoning', content: ev\.chunk \}\)/);
});

test('NodeRunner 快照保留已持久化的 reasoning', () => {
  assert.match(source, /projectNodeHistory\(this\.messages/);
  const history = projectNodeHistory([{ role: 'assistant', content: 'Done', reasoningContent: 'Reasoning' }]);
  assert.equal(history[0].reasoningContent, 'Reasoning');
});
