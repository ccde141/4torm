import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { activitySequence, appendActivityText, appendActivityTool, projectActivityTurn } from './activity-sequence';
import { buildConversationHistory } from './conversation-history';

test('display order does not duplicate the final answer or enter model history', () => {
  let message: ChatMessage = { id: 'a', role: 'assistant', timestamp: '', content: 'before\n\nafter',
    toolSteps: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok', status: 'done' }] };
  message = appendActivityText(message, 'before');
  message = appendActivityTool(message, 0);
  message = appendActivityText(message, 'after');
  assert.equal(activitySequence(message).length, 3);
  const plain = { ...message, activitySequence: undefined };
  assert.deepEqual(buildConversationHistory([message]), buildConversationHistory([plain]));
  assert.deepEqual(activitySequence({ ...message, content: 'before\n\nafter\n(连接中断: fixture)' }).at(-1),
    { kind: 'text', content: '(连接中断: fixture)' });
});

test('legacy sessions keep the existing rendering and unstreamed final answers remain visible', () => {
  const message: ChatMessage = { id: 'a', role: 'assistant', timestamp: '', content: 'Final answer' };
  assert.deepEqual(activitySequence(message), []);
  assert.deepEqual(activitySequence(appendActivityTool(message, 0)).at(-1),
    { kind: 'text', content: 'Final answer' });
});

test('turn preview leaves intermediate notes beside their tools and only trailing prose outside', () => {
  const message: ChatMessage = { id: 'turn', role: 'assistant', timestamp: '', content: 'beforeafter',
    activitySequence: [{ kind: 'text', content: 'before' }, { kind: 'tool', index: 0 },
      { kind: 'text', content: 'after' }] };
  const turn = projectActivityTurn(message);
  assert.deepEqual(turn.work, message.activitySequence!.slice(0, 2));
  assert.equal(turn.answer, 'after');
  const stopped = projectActivityTurn({ ...message, content: 'before',
    activitySequence: message.activitySequence!.slice(0, 2) });
  assert.equal(stopped.answer, '');
  assert.deepEqual(stopped.work, message.activitySequence!.slice(0, 2));
});

test('a collaboration event following prose keeps its real position in the visible process', () => {
  const sequence: NonNullable<ChatMessage['activitySequence']> = [
    { kind: 'text', content: '已汇报' },
    { kind: 'team', event: { id: 'report', memberId: 'member', timestamp: '2026-10-24T00:00:00Z', stage: 'reported' } },
  ];
  const turn = projectActivityTurn({ id: 'turn', role: 'assistant', timestamp: '', content: '已汇报', activitySequence: sequence });
  assert.equal(turn.answer, '');
  assert.deepEqual(turn.work, sequence);
});
