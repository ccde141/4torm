import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startTradewindExecution, stopActiveTradewindExecution,
  getActiveTradewindOrchestrator, isTradewindExecutionRunning } from '../../../services/tradewind-execution.js';
import { activeHumanGates } from '../../../engine/tradewind/nodes/human-gate.js';
import { createTradewindReadPort } from './read-adapter.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';
import { createTradewindCommands } from './control-adapter.js';

function graph(): WorkflowGraph {
  return { nodes: ['entry', 'human-gate', 'output'].map((type, index) => ({
    id: type, type, label: type, position: { x: index * 100, y: 0 }, config: {},
  })), edges: [
    { id: 'e1', source: 'entry', sourcePort: 0, target: 'human-gate', targetPort: 0, kind: 'handoff' },
    { id: 'e2', source: 'human-gate', sourcePort: 0, target: 'output', targetPort: 0, kind: 'handoff' },
  ] };
}

test('two real workflows keep identical node IDs separate and stopping one leaves the other healthy', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-isolated-'));
  t.after(async () => { await stopActiveTradewindExecution(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const start = (workflowId: string) => startTradewindExecution({ dataDir, workflowId, graph: graph(),
    initialInput: workflowId, trigger: { source: 'user' } });
  const [a, b] = await Promise.all([start('workflow-a'), start('workflow-b')]);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual(a.executionId, b.executionId);
  assert.equal(activeHumanGates.get('human-gate', a.executionId)?.envelopeContent, 'workflow-a');
  assert.equal(activeHumanGates.get('human-gate', b.executionId)?.envelopeContent, 'workflow-b');
  assert.throws(() => getActiveTradewindOrchestrator(), /execution|执行/);
  assert.throws(() => createTradewindReadPort(dataDir).nodeStatuses(), /execution|执行/);
  await assert.rejects(start('workflow-a'), /正在运行/);
  await stopActiveTradewindExecution({ executionId: a.executionId });
  assert.equal(isTradewindExecutionRunning({ executionId: b.executionId }), true);
  const second = getActiveTradewindOrchestrator({ executionId: b.executionId });
  activeHumanGates.get('human-gate', b.executionId)!.resolve({ content: 'B only' });
  assert.equal(await second!.whenSettled(), 'done');
});

test('a validation failure releases only its own start reservation', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-start-failure-'));
  t.after(async () => { await stopActiveTradewindExecution(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await assert.rejects(startTradewindExecution({ dataDir, workflowId: 'invalid',
    graph: { nodes: [], edges: [] }, trigger: { source: 'user' } }));
  assert.equal(isTradewindExecutionRunning({ workflowId: 'invalid' }), false);
  const result = await startTradewindExecution({ dataDir, workflowId: 'invalid', graph: graph(),
    trigger: { source: 'user' } });
  assert.equal(result.workflowId, 'invalid');
});

test('isolated data roots may run the same workflow ID and their runtime ports cannot select each other', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-root-isolation-'));
  const rootA = path.join(directory, 'A'); const rootB = path.join(directory, 'B');
  t.after(async () => { await stopActiveTradewindExecution(); await fs.rm(directory, { recursive: true, force: true }); });
  const start = (dataDir: string) => startTradewindExecution({ dataDir, workflowId: 'same-workflow',
    graph: graph(), trigger: { source: 'user' } });
  const [a, b] = await Promise.all([start(rootA), start(rootB)]);
  assert.throws(() => getActiveTradewindOrchestrator({ workflowId: 'same-workflow' }), /execution|执行/);
  assert.equal(getActiveTradewindOrchestrator({ workflowId: 'same-workflow', dataDir: rootA })?.getExecutionId(), a.executionId);
  assert.equal((createTradewindReadPort(rootA).nodeStatuses({ workflowId: 'same-workflow' }) as { executionId: string }).executionId, a.executionId);
  await assert.rejects(createTradewindCommands(rootA).stop({ executionId: b.executionId }));
  assert.equal(isTradewindExecutionRunning({ workflowId: 'same-workflow', dataDir: rootB }), true);
});
