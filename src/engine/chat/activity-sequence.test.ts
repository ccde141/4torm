import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage, TeamActivity } from '../../types';
import { activitySequence, appendActivityText, appendActivityTool, appendTeamActivity, projectActivityTurn } from './activity-sequence';
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

const report: TeamActivity = { id: 'first-notification', reportId: 'report-a', memberId: 'member-a',
  timestamp: '2026-10-26T04:49:00Z', stage: 'reported', preview: 'Connection reset' };

test('report retries use report and stage identity while distinct delivery stages remain visible', () => {
  const message: ChatMessage = { id: 'turn', role: 'assistant', timestamp: '', content: '',
    activitySequence: [{ kind: 'text', content: 'Checking' }, { kind: 'team', event: report },
      { kind: 'tool', index: 0 }] };
  const repeated = appendTeamActivity(message, { ...report, id: 'retry-notification',
    timestamp: '2026-10-26T05:00:00Z' });
  assert.equal(repeated, message);
  const injected = appendTeamActivity(repeated, { ...report, id: 'context-notification', stage: 'injected' });
  const nextReport = appendTeamActivity(injected, { ...report, id: 'another-report', reportId: 'report-b' });
  assert.deepEqual(nextReport.activitySequence!.slice(0, 3), message.activitySequence);
  assert.equal(nextReport.activitySequence!.filter(item => item.kind === 'team').length, 3);
});

test('an earlier factual event time can replace a replay time without moving the report', () => {
  const message: ChatMessage = { id: 'turn', role: 'assistant', timestamp: '', content: '',
    activitySequence: [{ kind: 'team', event: report }, { kind: 'tool', index: 0 }] };
  const updated = appendTeamActivity(message, { ...report, id: 'stable-notification',
    timestamp: '2026-10-25T14:00:00Z' });
  assert.deepEqual(updated.activitySequence, [{ kind: 'team', event: { ...report,
    timestamp: '2026-10-25T14:00:00Z' } }, { kind: 'tool', index: 0 }]);
  assert.equal(message.activitySequence![0].kind === 'team' && message.activitySequence![0].event.timestamp,
    '2026-10-26T04:49:00Z');
  assert.equal(appendTeamActivity(updated, { ...report, timestamp: 'invalid' }), updated);
});

test('legacy duplicate display projection keeps prose and tools ordered and leaves stored records intact', () => {
  const message: ChatMessage = { id: 'turn', role: 'assistant', timestamp: '', content: 'BeforeAfter',
    activitySequence: [{ kind: 'text', content: 'Before' }, { kind: 'team', event: report },
      { kind: 'tool', index: 0 }, { kind: 'team', event: { ...report, id: 'old-retry',
        timestamp: '2026-10-25T14:00:00Z' } }, { kind: 'text', content: 'After' }] };
  const original = structuredClone(message);
  const turn = projectActivityTurn(message);
  assert.deepEqual(turn.work, [{ kind: 'text', content: 'Before' },
    { kind: 'team', event: { ...report, timestamp: '2026-10-25T14:00:00Z' } }, { kind: 'tool', index: 0 }]);
  assert.equal(turn.answer, 'After');
  assert.deepEqual(message, original);
  assert.deepEqual(buildConversationHistory([message]), buildConversationHistory([{ ...message,
    activitySequence: undefined }]));
});

test('events without report identity retain existing event ID semantics', () => {
  const dispatched: TeamActivity = { id: 'assignment', memberId: 'member-a',
    timestamp: '2026-10-26T04:00:00Z', stage: 'dispatched' };
  const message: ChatMessage = { id: 'turn', role: 'assistant', timestamp: '', content: '' };
  const first = appendTeamActivity(message, dispatched);
  assert.equal(appendTeamActivity(first, { ...dispatched }), first);
  assert.equal(appendTeamActivity(first, { ...dispatched, id: 'next-assignment' }).activitySequence!.length, 2);
});
