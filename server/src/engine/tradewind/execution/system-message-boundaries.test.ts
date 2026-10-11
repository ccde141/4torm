import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeRunner } from './node-runner.js';
import { meetingContextMessages } from './meeting-compaction-context.js';

test('Tradewind operational broadcasts remain compressible history outside its protected identity', () => {
  const runner = new NodeRunner({ dataDir: '', workflowId: 'wf-a', executionId: 'exec-a',
    nodeId: 'node-a', agentId: 'agent-a', model: 'p:m', temperature: 0.7,
    toolNames: [], skillIds: [], workspace: '', sandboxLevel: 'project',
    systemPrompt: 'Static role and permissions', signal: new AbortController().signal });
  runner.appendSystemMessage('Upstream result and envelope routing facts');
  assert.deepEqual(runner.messages[0], { role: 'system', content: 'Static role and permissions' });
  assert.equal(runner.messages[1].role, 'user');
  assert.match(runner.messages[1].content, /Upstream result/);
});

test('meeting display summaries and speaker records do not become protected system instructions', () => {
  const projection = meetingContextMessages([{ speaker: '系统', content: 'Prior meeting summary', timestamp: 1 },
    { speaker: '人类', content: 'Continue the meeting', timestamp: 2 }]);
  assert.ok(projection.every(message => message.role !== 'system'));
  assert.match(projection[0].content, /Prior meeting summary/);
  assert.match(projection[1].content, /Continue the meeting/);
});
