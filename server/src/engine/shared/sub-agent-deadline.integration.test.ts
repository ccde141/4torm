import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSubAgent as runShared } from './sub-agent-runner.js';
import { runSubAgent as runTradewind } from '../tradewind/execution/sub-agent-runner.js';
import { resolveToolTransportContract } from '../../model-runtime/config/tool-transport-contract.js';
import type { SubAgentEvent } from './sub-agent-types.js';

async function fixture(t: test.TestContext, native: boolean, hold: boolean, repeat = false) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-delegation-deadline-'));
  let calls = 0;
  let closed!: () => void;
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const upstream = createServer(async (request, response) => {
    for await (const _ of request) { /* consume fixture model input */ }
    calls++;
    response.once('close', closed);
    if (hold) return;
    const name = repeat && calls <= 220 ? 'unavailable_tool' : 'done';
    const args = name === 'done' ? { summary: 'delegated task completed' } : {};
    const delta = native ? { tool_calls: [{ index: 0, id: `call-${calls}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] }
      : { content: JSON.stringify({ type: 'tool_call', name, arguments: args }) };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta,
      finish_reason: native ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  const provider = { id: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['model'] };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    toolTransports: { model: { status: native ? 'native-confirmed' : 'text-required', checkedAt: 'now',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } }] }));
  await fs.mkdir(path.join(dataDir, 'agents'));
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { id: 'worker', model: 'fixture:model', config: { tools: [], skills: [], toolMode: 'selected' } },
  }));
  const events: SubAgentEvent[] = [];
  return { dataDir, events, calls: () => calls, disconnected, params: {
    dataDir, agentId: 'worker', task: 'complete fixture task', context: '', systemPrompt: '',
    signal: new AbortController().signal, maxRounds: 2, emit: (event: SubAgentEvent) => events.push(event),
  } };
}

for (const [name, run] of [['shared', runShared], ['tradewind', runTradewind]] as const) {
  for (const native of [true, false]) {
    test(`${name} ${native ? 'native' : 'text'} delegation cannot exceed two hundred turns`, async t => {
      const f = await fixture(t, native, false, true);
      const result = await run({ ...f.params, maxRounds: 1_000 });
      assert.equal(f.calls(), 200);
      assert.equal(result.status, 'timeout');
      assert.equal(f.events.filter(event => event.type === 'done' || event.type === 'error').length, 1);
    });
    test(`${name} ${native ? 'native' : 'text'} delegation still completes through done`, async t => {
      const f = await fixture(t, native, false);
      const result = await run(f.params);
      assert.equal(result.status, 'success');
      assert.equal(result.summary, 'delegated task completed');
      assert.equal(f.calls(), 1);
      assert.deepEqual(f.events.filter(event => event.type === 'done' || event.type === 'error'),
        [{ type: 'done', data: result }]);
    });

    test(`${name} ${native ? 'native' : 'text'} deadline cancels an active model request`, { timeout: 5_000 }, async t => {
      const f = await fixture(t, native, true);
      const result = await run({ ...f.params, timeout: 1_000 });
      assert.equal(result.status, 'timeout');
      assert.equal(f.calls(), 1);
      const terminal = f.events.filter(event => event.type === 'done' || event.type === 'error');
      assert.deepEqual(terminal, [{ type: 'done', data: result }]);
      await f.disconnected;
      assert.deepEqual(f.events.filter(event => event.type === 'done' || event.type === 'error'), terminal);
    });
  }
}
