import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { NodeRunner, type MessageSource } from './node-runner';

const runner = fs.readFileSync('src/engine/tradewind/execution/node-runner.ts', 'utf8');
function createRunner(): NodeRunner {
  return new NodeRunner({
    dataDir: '', workflowId: 'wf-test', executionId: 'exec-test',
    nodeId: 'agent-node', agentId: 'agent', model: 'test', temperature: 0,
    toolNames: [], skillIds: [], workspace: '', sandboxLevel: 'project', systemPrompt: 'test',
    signal: new AbortController().signal,
  });
}

function activateRound(runner: NodeRunner, source: MessageSource, runId = 'round-current'): AbortController {
  const roundAbort = new AbortController();
  Object.assign(runner, {
    busy: true,
    currentRoundSource: source,
    roundAbort,
    roundIdentity: { runId, source, startedAt: '2026-09-30T00:00:00.000Z' },
  });
  return roundAbort;
}

test('信封与联络轮不能通过节点停止接口中止', () => {
  assert.match(runner, /private currentRoundSource: MessageSource \| null = null/);
  assert.match(runner, /canAbortRound\(\): boolean\s*\{[^}]*currentRoundSource === 'human'/s);
  assert.match(runner, /abortRound\(runId: string\): boolean/);
});

test('暂停只接受承载交付义务的轮次', () => {
  assert.match(runner, /pause\(runId: string\): boolean\s*\{[^}]*currentRoundSource === 'human'[^}]*return false/s);
});

test('运行时只允许人类轮停止', () => {
  const nodeRunner = createRunner();
  const envelopeAbort = activateRound(nodeRunner, 'envelope');
  assert.equal(nodeRunner.abortRound('round-current'), false);
  assert.equal(envelopeAbort.signal.aborted, false);

  const humanAbort = activateRound(nodeRunner, 'human');
  assert.equal(nodeRunner.abortRound('round-stale'), false);
  assert.equal(humanAbort.signal.aborted, false);
  assert.equal(nodeRunner.abortRound('round-current'), true);
  assert.equal(humanAbort.signal.aborted, true);
});

test('运行时只允许信封与联络轮暂停', () => {
  const nodeRunner = createRunner();
  const humanAbort = activateRound(nodeRunner, 'human');
  assert.equal(nodeRunner.pause('round-current'), false);
  assert.equal(humanAbort.signal.aborted, false);

  const contactAbort = activateRound(nodeRunner, 'contact');
  assert.equal(nodeRunner.pause('round-stale'), false);
  assert.equal(contactAbort.signal.aborted, false);
  assert.equal(nodeRunner.pause('round-current'), true);
  assert.equal(contactAbort.signal.aborted, true);
});

test('节点快照公开当前轮次身份与来源', () => {
  const nodeRunner = createRunner();
  activateRound(nodeRunner, 'human');
  assert.deepEqual(nodeRunner.getRoundIdentity(), {
    runId: 'round-current', source: 'human', startedAt: '2026-09-30T00:00:00.000Z',
  });
  assert.equal(nodeRunner.getSnapshot().runId, 'round-current');
  assert.match(runner, /roundSource\?: MessageSource \| null/);
  assert.match(runner, /roundSource: this\.pausedMsg\?\.source \?\? this\.currentRoundSource/);
});

test('运行状态探针不复制对话和轮次事件', () => {
  const nodeRunner = createRunner();
  activateRound(nodeRunner, 'contact');
  Object.assign(nodeRunner as unknown as { events: object }, {
    events: { getRoundLog: () => { throw new Error('轮次日志不应被状态探针读取'); } },
  });
  assert.deepEqual(nodeRunner.getRuntimeState(), {
    busy: true, paused: false, roundSource: 'contact', runId: 'round-current',
  });
});
