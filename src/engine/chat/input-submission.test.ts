import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverHumanInput, type InputSubmission } from './input-submission';

const input: InputSubmission = { agentId: 'agent', sessionId: 'session', runId: 'run', id: 'id', content: 'continue' };
const receipt = { id: input.id, content: input.content, runId: input.runId, sequence: 1, receivedAt: 'now' };
const journal = (included: boolean) => ({ entries: [receipt], active: false,
  checkpoint: { closed: true, includedIds: included ? ['id'] : [] } });

function harness(responses: Array<unknown | Error>, completed = true) {
  const methods: string[] = [];
  const turns: InputSubmission[] = [];
  const request = (async (_url, init) => {
    methods.push(init?.method ?? 'GET');
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return Response.json(value);
  }) as typeof fetch;
  return { methods, turns, ports: { request, settled: async () => completed,
    nextTurn: async (value: InputSubmission) => { turns.push(value); }, notify: () => {} } };
}

test('closed input waits for final save before starting exactly one ordinary turn', async () => {
  const h = harness([{ disposition: 'next-turn' }]);
  let finish!: (value: boolean) => void;
  h.ports.settled = () => new Promise(resolve => { finish = resolve; });
  const pending = deliverHumanInput(input, h.ports);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.turns.length, 0);
  finish(true);
  assert.equal(await pending, 'continued');
  assert.deepEqual(h.turns, [input]);
  assert.deepEqual(h.methods, ['POST']);
});

test('lost acknowledgement reconciles the same ID without a second POST', async () => {
  const h = harness([new TypeError('network'), journal(true), journal(true)]);
  assert.equal(await deliverHumanInput(input, h.ports), 'included');
  assert.equal(h.turns.length, 0);
  assert.deepEqual(h.methods, ['POST', 'GET', 'GET']);
});

test('received but unconsumed input becomes one next turn', async () => {
  const h = harness([{ receipt }, journal(false)]);
  assert.equal(await deliverHumanInput(input, h.ports), 'continued');
  assert.deepEqual(h.turns, [input]);
});

test('unknown acceptance with a live run never resends or starts another turn', async () => {
  const h = harness([new TypeError('network'), { entries: [], active: true }]);
  await assert.rejects(deliverHumanInput(input, h.ports), /确认|confirm/i);
  assert.deepEqual(h.methods, ['POST', 'GET']);
  assert.equal(h.turns.length, 0);
});

test('a confirmed closed journal safely resolves a lost request with no receipt', async () => {
  const h = harness([new TypeError('network'), { entries: [], active: false, checkpoint: { closed: true, includedIds: [] } }]);
  assert.equal(await deliverHumanInput(input, h.ports), 'continued');
  assert.equal(h.turns.length, 1);
});

test('stop, deletion, suspension or a failed stream never automatically continues', async () => {
  const h = harness([{ disposition: 'next-turn' }], false);
  assert.equal(await deliverHumanInput(input, h.ports), 'retained');
  assert.equal(h.turns.length, 0);
});

test('ownership conflicts and corrupt receipts remain real failures', async () => {
  const h = harness([{ receipt: { ...receipt, content: 'different' } }]);
  await assert.rejects(deliverHumanInput(input, h.ports));
  assert.equal(h.turns.length, 0);
  const rejected = harness([]);
  rejected.ports.request = (async () => Response.json({ error: 'ownership mismatch' }, { status: 409 })) as typeof fetch;
  await assert.rejects(deliverHumanInput(input, rejected.ports), /ownership/);
});
