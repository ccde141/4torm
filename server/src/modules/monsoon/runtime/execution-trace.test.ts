import assert from 'node:assert/strict';
import test from 'node:test';
import { MonsoonExecutionTrace } from './execution-trace.js';
import type { MonsoonEvent, MonsoonTurn } from './turn-contract.js';

test('execution positions count only displayed main operations and survive context boundaries', async () => {
  const trace = new MonsoonExecutionTrace();
  const positions: ReturnType<typeof trace.position>[] = [];
  const events: MonsoonEvent[] = [
    { type: 'token', content: 'before' },
    { type: 'tool-call', tool: 'read', args: {} },
    { type: 'tool-result', tool: 'read', result: 'found', ok: true },
    { type: 'delegate-start', delegateId: 'child', task: 'inspect' },
    { type: 'delegate-tool-call', delegateId: 'child', tool: 'read', args: {} },
    { type: 'compact-done', id: 'compact-a' },
    { type: 'token', content: 'after' },
    { type: 'tool-call', tool: 'write', args: {} },
    { type: 'reasoning', content: 'thought' },
  ];
  const turn = trace.wrap(fake(async emit => { for (const event of events) emit(event); }));
  await turn.chat('rules', [], () => positions.push(trace.position()), 'main-run');
  assert.deepEqual(positions[2], { runId: 'main-run', toolOffset: 1, textOffset: 6, reasoningOffset: 0, eventOffset: 3 });
  assert.deepEqual(positions[5], { runId: 'main-run', toolOffset: 2, textOffset: 6, reasoningOffset: 0, eventOffset: 6 });
  assert.deepEqual(positions[7], { runId: 'main-run', toolOffset: 3, textOffset: 11, reasoningOffset: 0, eventOffset: 8 });
  assert.deepEqual(positions[8], { runId: 'main-run', toolOffset: 3, textOffset: 11, reasoningOffset: 7, eventOffset: 9 });
  assert.equal(trace.position(), undefined);
  const resumed: ReturnType<typeof trace.position>[] = [];
  await turn.resume('continue', () => resumed.push(trace.position()), 'resumed-run');
  assert.equal(resumed[0]?.runId, 'resumed-run');
  assert.equal(resumed[0]?.toolOffset, 0);
});

test('a rejected concurrent call cannot replace active ownership, and failure releases its position', async () => {
  const trace = new MonsoonExecutionTrace();
  let reject!: (error: Error) => void;
  const turn = trace.wrap(fake(() => new Promise((_resolve, fail) => { reject = fail; })));
  const running = turn.chat('', [], () => {}, 'active-run');
  await assert.rejects(turn.chat('', [], () => {}, 'intruder'), /执行中/);
  assert.equal(trace.position()?.runId, 'active-run');
  reject(new Error('offline'));
  await assert.rejects(running, /offline/);
  assert.equal(trace.position(), undefined);
});

function fake(work: (emit: (event: MonsoonEvent) => void) => Promise<void>): MonsoonTurn {
  return { isBusy: () => false, isSuspended: () => false, getAgentId: () => 'agent-a',
    getInputRuntime: () => null, abort: () => {},
    chat: async (_prompt, _messages, emit) => { await work(emit); return { content: '', rawContent: '' }; },
    resume: async (_answer, emit) => { await work(emit); return { content: '', rawContent: '' }; } };
}
