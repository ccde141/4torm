import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginAgentActivity,
  clearAgentActivities,
  getAgentActivity,
  getAllAgentActivities,
  withAgentActivity,
} from './agent-activity.js';

test.beforeEach(() => clearAgentActivities());

test('aggregates active surfaces and keeps parallel runs independent', () => {
  const conversation = beginAgentActivity('agent-a', 'conversation');
  const tide = beginAgentActivity('agent-a', 'tide');

  assert.deepEqual(getAgentActivity('agent-a'), {
    busy: true,
    surfaces: ['conversation', 'tide'],
  });

  conversation.end();
  assert.deepEqual(getAgentActivity('agent-a'), { busy: true, surfaces: ['tide'] });

  tide.end();
  assert.deepEqual(getAgentActivity('agent-a'), { busy: false, surfaces: [] });
});

test('ending one handle twice cannot clear another activity', () => {
  const first = beginAgentActivity('agent-a', 'convection');
  const second = beginAgentActivity('agent-a', 'convection');

  first.end();
  first.end();
  assert.deepEqual(getAgentActivity('agent-a'), { busy: true, surfaces: ['convection'] });

  second.end();
  assert.deepEqual(getAgentActivity('agent-a'), { busy: false, surfaces: [] });
});

test('all activities can be read by agent id', () => {
  const handle = beginAgentActivity('agent-a', 'cyclone');
  beginAgentActivity('agent-b', 'tradewind');

  assert.deepEqual([...getAllAgentActivities().entries()], [
    ['agent-a', { busy: true, surfaces: ['cyclone'] }],
    ['agent-b', { busy: true, surfaces: ['tradewind'] }],
  ]);
  handle.end();
});

test('activity wrapper releases the run when execution fails', async () => {
  await assert.rejects(
    withAgentActivity('agent-a', 'conversation', async () => {
      throw new Error('failed');
    }),
    /failed/,
  );
  assert.deepEqual(getAgentActivity('agent-a'), { busy: false, surfaces: [] });
});

test('activity tracking does not serialize parallel runs of the same agent', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const entered: string[] = [];

  const first = withAgentActivity('agent-a', 'conversation', async () => {
    entered.push('conversation');
    await hold;
  });
  const second = withAgentActivity('agent-a', 'tide', async () => {
    entered.push('tide');
  });
  await Promise.resolve();

  assert.deepEqual(entered, ['conversation', 'tide']);
  release();
  await Promise.all([first, second]);
});
