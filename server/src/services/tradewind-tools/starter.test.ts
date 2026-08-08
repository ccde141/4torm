import assert from 'node:assert/strict';
import test from 'node:test';
import { execStartWorkflow } from './starter.js';

test('start_workflow forwards only stored workflow identity and initial input', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const outcome = await execStartWorkflow(
    'D:/test-data',
    { workflowId: 'wf-review', initialInput: '审阅这批资料' },
    { sessionId: 'session-1', agentId: 'agent-1' },
    async input => {
      calls.push(input);
      return {
        workflowId: 'wf-review',
        workflowName: '资料审阅',
        executionId: 'exec-1',
        runDir: 'D:/test-data/tradewind/runs/wf-review/exec-1',
        status: 'running',
      };
    },
  );

  assert.deepEqual(calls, [{
    dataDir: 'D:/test-data',
    workflowId: 'wf-review',
    initialInput: '审阅这批资料',
    trigger: { source: 'conversation', sessionId: 'session-1', agentId: 'agent-1' },
  }]);
  assert.equal(outcome.ok, true);
  assert.match(outcome.result, /资料审阅/);
  assert.deepEqual(outcome.meta.workflowExecution, {
    workflowId: 'wf-review',
    workflowName: '资料审阅',
    executionId: 'exec-1',
    runDir: 'D:/test-data/tradewind/runs/wf-review/exec-1',
    status: 'running',
  });
});

test('start_workflow reports runtime conflicts without retrying', async () => {
  const outcome = await execStartWorkflow(
    'D:/test-data',
    { workflowId: 'wf-review' },
    undefined,
    async () => { throw new Error('已有信风工作流正在运行'); },
  );

  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /已有信风工作流正在运行/);
});
