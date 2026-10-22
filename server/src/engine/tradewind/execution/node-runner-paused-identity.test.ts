import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeRunner } from './node-runner.js';

test('真实暂停收尾保留原轮次身份，续跑换新轮次且只重投一次，不启动模型请求', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  let rounds = 0;
  const runner = new NodeRunner({
    dataDir: '', workflowId: 'wf-test', executionId: 'exec-test', nodeId: 'writer', agentId: 'agent',
    model: 'test', temperature: 0, toolNames: [], skillIds: [], workspace: '', sandboxLevel: 'project',
    systemPrompt: 'test', signal: controller.signal,
    recordEvent: async type => {
      if (type !== 'agent-round-started') return;
      rounds++;
      await gate;
      throw new DOMException('test round interrupted before model invocation', 'AbortError');
    },
  });
  let deliveries = 0;
  const paused = new Promise<void>(resolve => runner.addEventListener(event => {
    if (event.type === 'paused') resolve();
  }));
  runner.push({ source: 'envelope', content: 'task', onComplete: () => { deliveries++; } });
  const original = runner.getRoundIdentity()!;
  assert.equal(runner.pause(original.runId), true);
  assert.equal(runner.pause(original.runId), false);
  release();
  await paused;
  // The listener fires inside the handler; let its finally block clear the active identity.
  await Promise.resolve();
  assert.equal(runner.getRoundIdentity(), null);
  assert.equal(runner.getSnapshot().pausedRunId, original.runId);
  assert.equal(runner.getRuntimeState().pausedRunId, original.runId);
  assert.equal(deliveries, 0);
  assert.equal(runner.resume('stale'), false);
  assert.equal(runner.isPaused(), true);
  const resumed = new Promise<string>(resolve => runner.addEventListener(event => {
    if (event.type === 'round-start' && event.runId !== original.runId) resolve(event.runId);
  }));
  assert.equal(runner.resume(original.runId), true);
  assert.equal(runner.resume(original.runId), false);
  const nextRunId = await resumed;
  assert.notEqual(nextRunId, original.runId);
  assert.equal(runner.getSnapshot().pausedRunId, undefined);
  assert.equal(rounds, 2);
  controller.abort();
});
