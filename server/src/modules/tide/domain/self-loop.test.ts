import assert from 'node:assert/strict';
import test from 'node:test';
import { extractNextPrompt } from './self-loop.js';

test('NEXT is consumed only as the final standalone line outside code examples', () => {
  for (const answer of [
    'Use [NEXT: example] in text',
    'first\n[NEXT: example]\nactual result',
    '```text\n[NEXT: example]',
    '~~~\n[NEXT: example]\n~~~',
    '[NEXT: ]', '[NEXT: first\nsecond]', '[NEXT: missing',
  ]) assert.deepEqual(extractNextPrompt(answer), { next: null, cleaned: answer });
  assert.deepEqual(extractNextPrompt('first\n[NEXT: example]\nactual result\n[NEXT: correct]\n\n'),
    { next: 'correct', cleaned: 'first\n[NEXT: example]\nactual result' });
  assert.deepEqual(extractNextPrompt('```\n[NEXT: example]\n```\r\n\r\n[NEXT: next task]\r\n'),
    { next: 'next task', cleaned: '```\n[NEXT: example]\n```' });
});
