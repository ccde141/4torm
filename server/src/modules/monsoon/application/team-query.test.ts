import assert from 'node:assert/strict';
import test from 'node:test';
import { MonsoonTeamQuery } from './team-query.js';

test('team query exposes bounded collaboration facts without member model context or permissions', async () => {
  const query = new MonsoonTeamQuery({
    recover: async () => ({ revision: 7, members: [{
      id: 'member-a', name: 'Research', mission: 'Long mission', rolePrompt: 'Role',
      taskContext: 'Context', constraints: 'Constraints', lifecycle: 'active',
      permissions: { tools: ['secret'], skills: [], sandboxLevel: 'project' },
      context: [{ role: 'assistant', content: 'private model context' }],
      run: { id: 'run-a', runtimeId: 'runtime', task: 'Task', status: 'completed' },
    }], reports: [{ id: 'report-a', memberId: 'member-a', runId: 'run-a', task: 'Task',
      outcome: 'completed', content: 'Result content', acknowledged: false }],
    agentId: 'agent-a', sessionId: 'session-a', version: 1,
    }),
    read: async () => { throw new Error('not used'); },
  });
  const snapshot = await query.summary('agent-a', 'session-a', { items: 10, textChars: 12 });
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.members[0]?.name, 'Research');
  assert.equal('context' in snapshot.members[0]!, false);
  assert.equal('permissions' in snapshot.members[0]!, false);
  assert.equal(snapshot.truncated, true);
  assert.ok(JSON.stringify(snapshot).length < 800);
});

test('team query context removes system and private reasoning fields', async () => {
  const query = new MonsoonTeamQuery({
    recover: async () => { throw new Error('not used'); },
    read: async () => ({ revision: 2, members: [{
      id: 'member-a', name: 'A', mission: '', rolePrompt: '', taskContext: '', constraints: '',
      lifecycle: 'active', permissions: { tools: [], skills: [], sandboxLevel: 'project' },
      context: [{ role: 'system', content: 'secret' },
        { role: 'assistant', content: 'answer', reasoningContent: 'private' }],
    }], reports: [], agentId: 'agent-a', sessionId: 'session-a', version: 1 }),
  });
  const detail = await query.context('agent-a', 'session-a', 'member-a');
  assert.deepEqual(detail.messages, [{ role: 'assistant', content: 'answer' }]);
});

test('历史成员不挤占活动视图，解散页按版本续读且保留时间与上下文入口', async () => {
  const members = Array.from({ length: 65 }, (_, i) => ({ id: `m${i}`, name: `成员${i}`, mission: '',
    rolePrompt: '', taskContext: '', constraints: '', lifecycle: 'dismissed' as 'dismissed' | 'active',
    recruitedAt: '2026-10-27T00:00:00Z', dismissedAt: '2026-10-28T00:00:00Z',
    context: [{ role: 'assistant' as const, content: `交付${i}` }] }));
  members.push({ ...members[0], id: 'active', lifecycle: 'active' });
  const state = { revision: 1, members, reports: Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`,
    memberId: 'active', task: '', content: '', outcome: 'completed', acknowledged: false })) };
  const query = new MonsoonTeamQuery({ recover: async () => state, read: async () => state });
  const active = await query.summary('agent', 'session', { items: 1, textChars: 10_000 }, { view: 'active' });
  assert.equal(active.members[0].id, 'active'); assert.equal(active.reports.length, 0);
  assert.equal(active.dismissedCount, 65); assert.equal(active.activeCount, 1);
  const history = await query.summary('agent', 'session', { items: 20, textChars: 10_000 }, { view: 'dismissed' });
  assert.equal(history.members.length, 20); assert.equal(history.nextOffset, 20);
  assert.equal(history.members[0].dismissedAt, members[0].dismissedAt);
  members[0].mission = '很长的职责'.repeat(10_000);
  const bounded = await query.summary('agent', 'session', { items: 20, textChars: 1_000 }, { view: 'dismissed' });
  assert.ok(bounded.members.every(member => member.name.length > 0));
  assert.equal(bounded.truncated, true);
  const next = await query.summary('agent', 'session', { items: 20, textChars: 10_000 },
    { view: 'dismissed', offset: history.nextOffset, revision: history.revision });
  assert.equal(next.members[0].id, 'm20');
  assert.equal((await query.context('agent', 'session', 'm20')).messages[0].content, '交付20');
  state.revision++;
  const whileBusy = await query.summary('agent', 'session', { items: 20, textChars: 10_000 },
    { view: 'dismissed', cursor: history.nextCursor });
  assert.equal(whileBusy.members[0].id, 'm20');
  await assert.rejects(query.summary('agent', 'session', { items: 20, textChars: 10_000 },
    { view: 'dismissed', offset: 40, revision: 1 }), /记录已变化/);
  members[0].lifecycle = 'active';
  await assert.rejects(query.summary('agent', 'session', { items: 20, textChars: 10_000 },
    { view: 'dismissed', cursor: history.nextCursor }), /记录已变化/);
});
