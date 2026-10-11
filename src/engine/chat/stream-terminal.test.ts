import assert from 'node:assert/strict';
import test from 'node:test';
import { interruptedStreamContent, StreamTerminal } from './stream-terminal';

test('a clean socket close is not proof that a run finished', () => {
  const state = new StreamTerminal();
  state.observe('answer');
  assert.throws(() => state.assertClosed(false), /完成事件/);
  state.observe('done');
  assert.doesNotThrow(() => state.assertClosed(false));
});

test('explicit failures and user abort are terminal without fabricating completion', () => {
  const failed = new StreamTerminal();
  failed.observe('error');
  assert.doesNotThrow(() => failed.assertClosed(false));
  assert.doesNotThrow(() => new StreamTerminal().assertClosed(true));
});

test('an interrupted stream keeps partial output and shows the interruption', () => {
  assert.match(interruptedStreamContent('partial', 'socket closed'), /partial[\s\S]*socket closed/);
  assert.match(interruptedStreamContent('', 'socket closed'), /socket closed/);
});
