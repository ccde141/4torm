import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { NodeRunner, type MessageSource } from './node-runner';

const runner = fs.readFileSync('src/engine/tradewind/execution/node-runner.ts', 'utf8');
const route = fs.readFileSync('src/routes/tradewind.ts', 'utf8');

function createRunner(): NodeRunner {
  return new NodeRunner({
    dataDir: '', nodeId: 'agent-node', agentId: 'agent', model: 'test', temperature: 0,
    toolNames: [], skillIds: [], workspace: '', sandboxLevel: 'project', systemPrompt: 'test',
    signal: new AbortController().signal,
  });
}

function activateRound(runner: NodeRunner, source: MessageSource): AbortController {
  const roundAbort = new AbortController();
  Object.assign(runner, { busy: true, currentRoundSource: source, roundAbort });
  return roundAbort;
}

test('信封与联络轮不能通过节点停止接口中止', () => {
  assert.match(runner, /private currentRoundSource: MessageSource \| null = null/);
  assert.match(runner, /canAbortRound\(\): boolean\s*\{[^}]*currentRoundSource === 'human'/s);
  assert.match(runner, /abortRound\(\): boolean\s*\{[^}]*if \(!this\.canAbortRound\(\)\) return false/s);

  const abortStart = route.indexOf("app.post('/chat/:nodeId/abort'");
  const abortBlock = route.slice(abortStart, route.indexOf("app.post('/chat/:nodeId/pause'", abortStart));
  assert.match(abortBlock, /if \(!runner\.abortRound\(\)\)/);
});

test('暂停只接受承载交付义务的轮次', () => {
  assert.match(runner, /pause\(\): boolean\s*\{[^}]*currentRoundSource === 'human'[^}]*return false/s);
});

test('运行时只允许人类轮停止', () => {
  const nodeRunner = createRunner();
  const envelopeAbort = activateRound(nodeRunner, 'envelope');
  assert.equal(nodeRunner.abortRound(), false);
  assert.equal(envelopeAbort.signal.aborted, false);

  const humanAbort = activateRound(nodeRunner, 'human');
  assert.equal(nodeRunner.abortRound(), true);
  assert.equal(humanAbort.signal.aborted, true);
});

test('运行时只允许信封与联络轮暂停', () => {
  const nodeRunner = createRunner();
  const humanAbort = activateRound(nodeRunner, 'human');
  assert.equal(nodeRunner.pause(), false);
  assert.equal(humanAbort.signal.aborted, false);

  const contactAbort = activateRound(nodeRunner, 'contact');
  assert.equal(nodeRunner.pause(), true);
  assert.equal(contactAbort.signal.aborted, true);
});

test('节点快照公开当前轮次来源', () => {
  assert.match(runner, /roundSource\?: MessageSource \| null/);
  assert.match(runner, /roundSource: this\.pausedMsg\?\.source \?\? this\.currentRoundSource/);
});
