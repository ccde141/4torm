import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSubAgent as runShared } from './sub-agent-runner.js';
import { runSubAgent as runTradewind } from '../tradewind/execution/sub-agent-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from './compaction/index.js';
import { resolveToolTransportContract } from '../../model-runtime/config/tool-transport-contract.js';
import type { SubAgentEvent } from './sub-agent-types.js';
import type { ContextMessage } from './types.js';
import { subAgentCompaction } from './sub-agent-compaction.js';
import { callPreparedModel } from './react/model-call.js';
import { runTextSubAgentLoop } from './text-sub-agent-loop.js';

const tool = { name: 'fixture_evidence', description: 'Return synthetic evidence', executorType: 'custom',
  executorFile: 'fixture_evidence', parameters: { type: 'object', properties: { index: { type: 'integer' } } } };

function stream(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`
    + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

async function fixture(t: test.TestContext, native: boolean, overflow: boolean, cyclone = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-subagent-compact-'));
  const dataDir = path.join(root, 'data');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools/executors'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools/registry.json'), JSON.stringify([tool]));
  await fs.writeFile(path.join(dataDir, 'tools/executors/fixture_evidence.js'),
    `export default args => 'EVIDENCE-' + args.index + ':' + '据'.repeat(24000);`);
  await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({
    worker: { name: 'Worker', model: 'fixture:model', config: { tools: [tool.name], toolMode: 'selected', skills: [] } },
  }));
  const provider = { id: 'fixture', baseUrl: 'https://subagent-compaction.test/v1', models: ['model'] };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    toolTransports: { model: { status: native ? 'native-confirmed' : 'text-required', checkedAt: 'fixture',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } }] }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, monsoon: overflow || cyclone ? 240_000 : 40_000,
      tradewindConversation: overflow || cyclone ? 240_000 : 40_000,
      cycloneConversation: cyclone ? 40_000 : policy.thresholds.cycloneConversation } });
  let summaries = 0, tools = 0, rejections = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const last = body.messages.at(-1);
    if (typeof last?.content === 'string' && last.content.startsWith('你负责把已有会话整理')) {
      summaries++;
      return stream('TASK-42: earlier evidence was verified. Continue the unfinished task.');
    }
    assert.equal(!!body.tools?.length, native, 'the fixture must exercise the selected real transport');
    const text = JSON.stringify(body.messages);
    if (overflow && text.length > 70_000) {
      rejections++;
      return new Response('{"error":{"code":"context_length_exceeded","message":"fixture limit"}}', { status: 400 });
    }
    if (summaries) assert.ok(!text.includes('EVIDENCE-1:'), 'compressed tool output must not return to later requests');
    const name = tools < 8 ? tool.name : 'done';
    const args = name === 'done' ? { summary: 'TASK-42 complete' } : { index: ++tools };
    if (!native) return stream(JSON.stringify({ type: 'tool_call', name, arguments: args }));
    const payload = { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${tools}-${name}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const events: SubAgentEvent[] = [];
  return { dataDir, events, summaries: () => summaries, rejections: () => rejections,
    params: { dataDir, agentId: 'worker', task: 'Complete TASK-42.', context: '', systemPrompt: '',
      signal: new AbortController().signal, maxRounds: 20, emit: (event: SubAgentEvent) => events.push(event) } };
}

for (const [entry, run] of [['shared', runShared], ['tradewind', runTradewind]] as const) {
  for (const native of [true, false]) for (const overflow of [false, true]) {
    test(`${entry} ${native ? 'native' : 'text'} delegation repeatedly compacts via ${overflow ? 'overflow' : 'threshold'} and reaches done`, async t => {
      const f = await fixture(t, native, overflow);
      const result = await run(f.params);
      assert.equal(result.status, 'success', result.error);
      assert.equal(result.summary, 'TASK-42 complete');
      assert.ok(f.summaries() >= 2);
      assert.equal(f.rejections() > 0, overflow);
      assert.deepEqual(f.events.filter(event => event.type === 'tool_call').map(event => event.data.args.index),
        Array.from({ length: 8 }, (_, index) => index + 1));
      assert.equal(f.events.filter(event => event.type === 'done' || event.type === 'error').length, 1);
    });
  }
}

for (const native of [true, false]) {
  test(`Cyclone ${native ? 'native' : 'text'} delegation uses its owning area's threshold`, async t => {
    const f = await fixture(t, native, false, true);
    const result = await runShared({ ...f.params, compactionArea: 'cycloneConversation' });
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.summary, 'TASK-42 complete');
    assert.ok(f.summaries() >= 2, 'the Cyclone threshold must apply while Monsoon stays below its higher threshold');
    assert.deepEqual(f.events.filter(event => event.type === 'tool_call').map(event => event.data.args.index),
      Array.from({ length: 8 }, (_, index) => index + 1));
  });
}

test('a large truncated JSON envelope survives compaction intact until continuation completes', async t => {
  const f = await fixture(t, false, false);
  const summarize = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.ok(!String(init?.body).includes('PARTIAL-JSON-'), 'the incomplete envelope cannot become summary input');
    return summarize(input, init);
  });
  const messages: ContextMessage[] = [{ role: 'system', content: 'Finish TASK-42 using done.' },
    { role: 'user', origin: 'human', content: 'TASK-42: inspect evidence.' },
    { role: 'assistant', content: '{"type":"tool_call","name":"fixture_evidence","arguments":{"index":0}}' },
    { role: 'user', content: '{"type":"tool_result","name":"fixture_evidence","ok":true,"content":"' + '旧'.repeat(70_000) + '"}' }];
  const partial = '{"type":"tool_call","name":"done","arguments":{"summary":"PARTIAL-JSON-' + '新'.repeat(40_000);
  let requests = 0;
  const llm = subAgentCompaction({ call: async history => {
    requests++;
    if (requests === 1) return { content: partial, finishReason: 'length' };
    assert.equal(history.at(-2)?.content, partial);
    assert.ok(history.at(-1)?.content.startsWith('[System: continuation]'));
    return { content: 'END"}}', finishReason: 'stop' };
  } }, { dataDir: f.dataDir, model: 'fixture:model', agent: { id: 'worker', name: 'Worker', model: 'fixture:model',
    rolePrompt: '', tools: [], skills: [], toolMode: 'selected', temperature: 0, workspace: '', sandboxLevel: 'project' } });
  const result = await runTextSubAgentLoop({ messages, signal: f.params.signal, maxRounds: 2,
    callModel: onPartial => callPreparedModel(llm, messages, f.params.signal, { onChunk: onPartial }),
    callTool: async () => assert.fail('done is interpreted only after its JSON envelope is complete') });
  assert.equal(result.status, 'success');
  assert.equal(result.summary, 'PARTIAL-JSON-' + '新'.repeat(40_000) + 'END');
  assert.equal(requests, 2);
  assert.ok(f.summaries() >= 1);
  assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
});
