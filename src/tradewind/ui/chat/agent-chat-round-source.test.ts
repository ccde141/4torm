import assert from 'node:assert/strict';
import test from 'node:test';
import { roundSourceFromSnapshot } from './agent-chat-runtime';

test('重连时从快照恢复信封轮身份而不是显示停止按钮', () => {
  assert.equal(roundSourceFromSnapshot({ roundSource: 'envelope', roundLog: [] }), 'envelope');
  assert.equal(roundSourceFromSnapshot({ roundLog: [
    { type: 'user-message', source: 'contact' },
  ] }), 'contact');
  assert.equal(roundSourceFromSnapshot({ roundLog: [
    { type: 'user-message', source: 'unknown' },
  ] }), null);
});
