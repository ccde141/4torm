import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { memberExecutor } from './executor.js';
import { TeamStore } from './store.js';
import type { SessionRunnerOpts } from '../session-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/policy.js';
import { formatTextToolCall } from '../../shared/text-tool-protocol.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import type { ContextMessage } from '../../shared/types.js';

function stream(delta: Record<string, unknown>, finish = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
}

for (const native of [true, false]) test(`a ${native ? 'native' : 'text'} team member recovers a provider overflow inside the same tool loop`, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-provider-overflow-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const provider = { id: 'p', baseUrl: 'https://team-overflow.test/v1', models: ['model'] };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    toolTransports: { model: { status: native ? 'native-confirmed' : 'text-required',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint, checkedAt: '2026-01-01T00:00:00Z' } },
  }] }));
  const permissions = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const store = new TeamStore(dataDir, { agentId: 'agent', sessionId: 'session' });
  const member = await store.create({ name: 'Researcher', mission: 'TASK-42', rolePrompt: '',
    taskContext: '', constraints: '', permissions }, permissions);
  const context: ContextMessage[][] = [];
  let calls = 0, tools = 0, summaries = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (JSON.stringify(body.messages.at(-1)).includes('你负责把已有会话整理')) {
      summaries++;
      return stream({ content: 'TASK-42: the reported evidence is verified; complete the original task.' });
    }
    assert.equal(Boolean(body.tools?.length), native);
    calls++;
    if (calls <= 8) {
      const args = { content: `Evidence batch ${calls}`, messageId: `progress-${calls}` };
      return native ? stream({ tool_calls: [{ index: 0, id: `report-${calls}`, type: 'function',
        function: { name: 'team_report', arguments: JSON.stringify(args) } }] }, 'tool_calls')
        : stream({ content: formatTextToolCall('team_report', args) });
    }
    if (calls === 9) return new Response('{"error":{"code":"context_length_exceeded"}}', { status: 400 });
    assert.match(JSON.stringify(body.messages), /TASK-42: the reported evidence/);
    assert.doesNotMatch(JSON.stringify(body.messages), /OLD-TOOL-EVIDENCE-1:/);
    return stream({ content: 'TASK-42 completed after overflow.' });
  });
  const result = await memberExecutor({ dataDir, agentId: 'agent', sessionId: 'session', model: 'p:model',
    temperature: 0, toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native,
    maxTurns: 1 })(member, 'TASK-42 first assignment', async value => { context.push(structuredClone(value)); },
    new AbortController().signal, { inbox: async () => ({ messages: [], commit: async () => {} }),
      report: async () => ({ evidence: `OLD-TOOL-EVIDENCE-${++tools}:` + '据'.repeat(70_000) }), observe: () => {} });
  assert.match(result, /TASK-42 completed after overflow/);
  assert.equal(calls, 10);
  assert.equal(tools, 8);
  assert.equal(summaries, 1);
  assert.match(JSON.stringify(context.at(-1)), /TASK-42 completed after overflow/);
});

for (const native of [true, false]) for (const outcome of ['failed', 'aborted'] as const) {
  test(`a ${native ? 'native' : 'text'} team member resumes after multiple compactions and ${outcome} output without reviving old tools`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-compaction-continuation-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    const provider = { id: 'p', baseUrl: 'https://team-compaction.test/v1', models: ['model'] };
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
      toolTransports: { model: { status: native ? 'native-confirmed' : 'text-required',
        fingerprint: resolveToolTransportContract(provider, 'model').fingerprint, checkedAt: '2026-01-01T00:00:00Z' } },
    }] }));
    const policy = defaultCompactionPolicy();
    await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
      thresholds: { ...policy.thresholds, monsoon: 40_000 } });
    const owner = { agentId: 'agent', sessionId: 'session' };
    const store = new TeamStore(dataDir, owner);
    const permissions = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = await store.create({ name: 'Researcher', mission: 'TASK-42', rolePrompt: '',
      taskContext: '', constraints: '', permissions }, permissions);
    const parent: SessionRunnerOpts = { ...owner, dataDir, model: 'p:model', temperature: 0,
      toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native,
      maxTurns: 1 };
    const execute = memberExecutor(parent);
    const controller = new AbortController();
    let tools = 0, summaries = 0, modelCalls = 0, nextAssignment = false, truncated = false;
    const currentOutput = 'UNFINISHED-CURRENT-REPLY';
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (JSON.stringify(body.messages.at(-1)).includes('你负责把已有会话整理')) {
        summaries++;
        return stream({ content: 'TASK-42: earlier evidence is verified; continue the current assignment.' });
      }
      assert.equal(Boolean(body.tools?.length), native, 'the selected tool transport must be exercised');
      const sent = JSON.stringify(body.messages);
      if (nextAssignment) {
        assert.equal(sent.split(currentOutput).length - 1, 1, 'received interrupted output appears once on the next assignment');
        assert.doesNotMatch(sent, /TOOL-EVIDENCE-1:/);
        assert.match(sent, /TOOL-EVIDENCE-24:/);
        assert.match(sent, /TASK-42: earlier evidence/);
        if (outcome === 'failed') assert.equal(sent.split('LENGTH-FIRST-PART').length - 1, 1);
        return stream({ content: 'TASK-42 resumed and completed.' });
      }
      modelCalls++;
      if (tools === 24) {
        assert.doesNotMatch(sent, /TOOL-EVIDENCE-1:/);
        assert.match(sent, /TOOL-EVIDENCE-24:/);
        if (outcome === 'aborted') return stream({ content: currentOutput });
        if (!truncated) { truncated = true; return stream({ content: 'LENGTH-FIRST-PART' }, 'length'); }
        let step = 0;
        return new Response(new ReadableStream({ pull(target) {
          if (step++ === 0) target.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [
            { delta: { content: currentOutput }, finish_reason: null },
          ] })}\n\n`));
          else target.error(new Error('Fixture disconnected'));
        } }), { headers: { 'content-type': 'text/event-stream' } });
      }
      assert.ok(modelCalls <= 25, 'the original loop must make forward progress');
      const args = { content: `Observed batch ${tools + 1}`, messageId: `progress-${tools + 1}` };
      return native ? stream({ tool_calls: [{ index: 0, id: `report-${tools + 1}`, type: 'function',
        function: { name: 'team_report', arguments: JSON.stringify(args) } }] }, 'tool_calls')
        : stream({ content: formatTextToolCall('team_report', args) });
    });
    const control = { inbox: async () => ({ messages: [], commit: async () => {} }),
      report: async () => ({ evidence: `TOOL-EVIDENCE-${++tools}:` + '据'.repeat(8_000) }),
      observe: (event: import('../session-runner-contracts.js').ConversationEvent) => {
        if (outcome === 'aborted' && event.type === 'token' && event.content.includes(currentOutput)) controller.abort();
      } };
    const started = await store.start(member.id, 'TASK-42 first assignment', permissions);
    const checkpoint = (context: ContextMessage[]) => store.checkpoint(member.id, started.id, context);
    const running = execute(member, 'TASK-42 first assignment', checkpoint, controller.signal, control);
    if (outcome === 'failed') await assert.rejects(running, /Fixture disconnected|读取|连接|响应|模型请求失败/); else await running;
    await store.finish(member.id, started.id, outcome, 'The current response did not finish.');
    assert.equal(tools, 24, 'successful tools are never replayed during compaction or model continuation');
    assert.ok(summaries >= 2, 'the same execution must complete more than one compaction');
    const reloaded = new TeamStore(dataDir, owner);
    const saved = (await reloaded.read()).members[0];
    const savedText = JSON.stringify(saved.context);
    assert.equal(savedText.split(currentOutput).length - 1, 1);
    if (outcome === 'failed') assert.equal(savedText.split('LENGTH-FIRST-PART').length - 1, 1);
    assert.doesNotMatch(savedText, /TOOL-EVIDENCE-1:/);
    assert.match(savedText, /TOOL-EVIDENCE-24:/);
    assert.ok(saved.context.some(message => message.content.startsWith('[历史压缩记录]')));
    const archives = await fs.readdir(path.join(dataDir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.team`, 'compactions'));
    assert.equal(archives.length, summaries);
    nextAssignment = true;
    const next = await reloaded.start(member.id, 'TASK-42 resume explicitly', permissions);
    await execute(saved, 'TASK-42 resume explicitly', context => reloaded.checkpoint(member.id, next.id, context),
      new AbortController().signal, { ...control, observe: () => {} });
    await reloaded.finish(member.id, next.id, 'completed', 'TASK-42 completed.');
    assert.equal(tools, 24);
    const finalContext = (await reloaded.read()).members[0].context;
    assert.equal(finalContext.filter(message => message.content === 'TASK-42 resumed and completed.').length, 1);
  });
}
