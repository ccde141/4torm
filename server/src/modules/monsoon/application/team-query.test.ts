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
