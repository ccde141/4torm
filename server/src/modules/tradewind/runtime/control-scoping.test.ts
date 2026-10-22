import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { NodeRunner, type MessageSource } from '../../../engine/tradewind/execution/node-runner.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import type { Orchestrator } from '../../../engine/tradewind/orchestrator/index.js';
import { reserveTradewindExecution, finishTradewindStart, forgetTradewindExecution } from '../../../services/tradewind-execution-registry.js';
import { createTradewindCommands } from './control-adapter.js';

function execution(t: TestContext, dataDir: string, onStop?: () => Promise<void>) {
  const workflowId = `workflow-${randomUUID()}`;
  const executionId = `execution-${randomUUID()}`;
  let running = true;
  let stopCalls = 0;
  const slot = reserveTradewindExecution(dataDir, workflowId);
  slot.orchestrator = {
    getExecutionId: () => executionId, getWorkflowId: () => workflowId,
    isRunning: () => running,
    stop: async () => { stopCalls++; await onStop?.(); running = false; },
  } as unknown as Orchestrator;
  finishTradewindStart(slot);
  t.after(() => { running = false; activeNodeRunners.clear(executionId); forgetTradewindExecution(workflowId, dataDir); });
  return { workflowId, executionId, running: () => running, stopCalls: () => stopCalls };
}

function node(dataDir: string, identity: { workflowId: string; executionId: string }, source: MessageSource, runId: string) {
  const runner = new NodeRunner({ dataDir, ...identity, nodeId: 'writer', agentId: 'agent', model: 'test',
    temperature: 0, toolNames: [], skillIds: [], workspace: '', sandboxLevel: 'project',
    systemPrompt: 'test', signal: new AbortController().signal });
  const roundAbort = new AbortController();
  Object.assign(runner, { busy: true, currentRoundSource: source, roundAbort,
    roundIdentity: { runId, source, startedAt: new Date().toISOString() } });
  activeNodeRunners.set('writer', runner);
  return { runner, signal: roundAbort.signal };
}

test('同名节点和轮次也只干预指定执行，过期轮次及错误数据根不能越界', async t => {
  const dataDir = `test-root-${randomUUID()}`;
  const first = execution(t, dataDir); const second = execution(t, dataDir);
  const a = node(dataDir, first, 'human', 'round-shared');
  const b = node(dataDir, second, 'human', 'round-shared');
  const commands = createTradewindCommands(dataDir);
  await assert.rejects(commands.abortNodeRound({ nodeId: 'writer', runId: 'round-shared' }), /指定 executionId/);
  await assert.rejects(commands.abortNodeRound({ executionId: first.executionId, nodeId: 'writer', runId: 'stale' }), /轮次已经变化/);
  await assert.rejects(createTradewindCommands('foreign-root').abortNodeRound({ executionId: first.executionId,
    nodeId: 'writer', runId: 'round-shared' }), /没有运行中的/);
  assert.equal(a.signal.aborted, false); assert.equal(b.signal.aborted, false);
  await commands.abortNodeRound({ executionId: second.executionId, nodeId: 'writer', runId: 'round-shared' });
  assert.equal(a.signal.aborted, false); assert.equal(b.signal.aborted, true);
  await assert.rejects(commands.abortNodeRound({ executionId: second.executionId, nodeId: 'writer', runId: 'round-shared' }), /单独停止/);
});

test('暂停保留交付义务，仅恢复所读到的暂停轮，重复请求不产生重复投递', async t => {
  const dataDir = `test-root-${randomUUID()}`;
  const active = execution(t, dataDir);
  const { runner, signal } = node(dataDir, active, 'envelope', 'round-envelope');
  const commands = createTradewindCommands(dataDir);
  const input = { executionId: active.executionId, nodeId: 'writer', runId: 'round-envelope' };
  await assert.rejects(commands.abortNodeRound(input), /单独停止/);
  await commands.pauseNodeRound(input);
  assert.equal(signal.aborted, true);
  await assert.rejects(commands.pauseNodeRound(input), /可暂停/);
  let deliveries = 0;
  Object.assign(runner, { busy: false, roundIdentity: null, pausedMsg: { source: 'envelope', content: 'task' },
    pausedRoundIdentity: { runId: input.runId, source: 'envelope', startedAt: '2026-10-21T00:00:00.000Z' } });
  const contactAbort = new AbortController();
  Object.assign(runner, { busy: true, currentRoundSource: 'contact', roundAbort: contactAbort,
    roundIdentity: { runId: 'contact-round', source: 'contact', startedAt: '2026-10-21T00:00:00.000Z' } });
  assert.equal(runner.pause('contact-round'), false);
  assert.equal(contactAbort.signal.aborted, false);
  assert.equal(runner.getSnapshot().roundSource, 'contact');
  runner.push = () => { deliveries++; };
  assert.equal(runner.getSnapshot().pausedRunId, input.runId);
  await assert.rejects(commands.resumeNodeRound({ ...input, runId: 'stale' }), /轮次已经变化/);
  assert.equal(deliveries, 0);
  await commands.resumeNodeRound(input);
  assert.equal(deliveries, 1);
  assert.equal(runner.getSnapshot().pausedRunId, undefined);
  await assert.rejects(commands.resumeNodeRound(input), /轮次已经变化/);
  assert.equal(deliveries, 1);
});

test('停止只终止指定执行，重复并发停止被拒绝，其他工作流继续运行', async t => {
  const dataDir = `test-root-${randomUUID()}`;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = execution(t, dataDir, () => pending); const second = execution(t, dataDir);
  const commands = createTradewindCommands(dataDir);
  const stopping = commands.stop({ executionId: first.executionId });
  await assert.rejects(commands.stop({ executionId: first.executionId }), /已经收到停止请求/);
  assert.equal(first.stopCalls(), 1); assert.equal(second.running(), true);
  release();
  assert.deepEqual(await stopping, { stopped: true, executionId: first.executionId });
  await assert.rejects(commands.stop({ executionId: first.executionId }), /没有运行中的/);
  assert.equal(second.running(), true); assert.equal(second.stopCalls(), 0);
});
