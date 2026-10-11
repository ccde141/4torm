import assert from 'node:assert/strict';
import test from 'node:test';
import type { NodeRunnerEvent, NodeRunnerOpts } from './node-runner.js';
import { clearContactRegistry } from './contact-registry.js';
import { execContact } from './node-runner-tools.js';
import { execMeetingContact, shouldAttachMeetingToolCaller } from './meeting-handlers.js';

test('node contact reports missing target as failed outcome and one failed event', async () => {
  clearContactRegistry();
  const options: NodeRunnerOpts = {
    dataDir: '', workflowId: 'wf', executionId: 'run', nodeId: 'node',
    agentId: 'agent', model: 'model', temperature: 0, toolNames: [], skillIds: [],
    workspace: '.', sandboxLevel: 'project', systemPrompt: '', signal: new AbortController().signal,
  };
  const events: NodeRunnerEvent[] = [];
  const outcome = await execContact(options, { target: 'missing', message: 'hello' }, event => events.push(event));
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /^联络失败：/);
  assert.deepEqual(events.filter(event => event.type === 'contact-done').map(event => event.ok), [false]);
});

test('meeting contact returns typed failure for an absent participant', async () => {
  clearContactRegistry();
  const outcome = await execMeetingContact({ target: 'missing', message: 'hello' }, 'host', 'meeting');
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /^联络失败：/);
});

test('meeting text mode keeps contact callable with no configured local tools', () => {
  assert.equal(shouldAttachMeetingToolCaller([], false, ['other']), true);
  assert.equal(shouldAttachMeetingToolCaller([], false, []), false);
});
