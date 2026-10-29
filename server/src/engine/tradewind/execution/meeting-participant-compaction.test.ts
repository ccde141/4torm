import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../../shared/types.js';
import { runReActLoopNative, type LLMCaller } from '../../shared/react/native-loop.js';
import { runReActLoop } from '../../shared/react/text-loop.js';
import { callPreparedModel } from '../../shared/react/model-call.js';
import { formatTextToolCall, parseTextToolResponse, parseTextToolResult } from '../../shared/text-tool-protocol.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/index.js';
import { createMeetingSession } from './meeting-session.js';
import { meetingCompactionTransform } from './meeting-context-compaction.js';
import { meetingContextMessages } from './meeting-compaction-context.js';

async function fixture(t: test.TestContext, onSummary?: () => void) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-participant-compact-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair' },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://fixture.invalid/v1', models: ['chair'], nativeMode: 'text' },
  ] }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, tradewindMeeting: 1_000 } });
  const previous = globalThis.fetch;
  let summaries = 0;
  globalThis.fetch = async () => {
    onSummary?.();
    return new Response(`data: ${JSON.stringify({ choices: [{
      delta: { content: `交接${++summaries}：已核验的工具结果与交付状态` }, finish_reason: 'stop',
    }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: 'Review',
    chairAgentId: 'chair', participants: [], topic: 'Delivery' });
  session.publicMessages = [{ speaker: '人类', content: '核验全部资料并交付', timestamp: 1 }];
  session.streamingCurrent = { speaker: 'Writer', content: '', reasoning: '', toolCount: 0 };
  return { dataDir, session, summaries: () => summaries,
    messages: [{ role: 'system' as const, content: 'Identity' }, ...meetingContextMessages(session.publicMessages)] };
}

function assertPaired(messages: readonly ContextMessage[], native: boolean) {
  const pending = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) pending.add(call.id);
    if (message.role === 'tool') assert.ok(pending.delete(message.toolCallId!), 'native result retains its call');
    if (!native && message.role === 'assistant') {
      const call = parseTextToolResponse(message.content);
      if (call.kind === 'tool-call') pending.add(call.name);
    }
    if (!native && message.role === 'user') {
      const result = parseTextToolResult(message.content);
      if (result) assert.ok(pending.delete(result.name), 'text result retains its call');
    }
  }
  assert.equal(pending.size, 0, 'compaction never exposes an incomplete tool pair');
}

for (const native of [true, false]) {
  test(`one ${native ? 'native' : 'text'} participant turn can compact repeatedly without replaying tools`, async t => {
    const { dataDir, session, messages, summaries } = await fixture(t);
    const originalPublic = structuredClone(session.publicMessages);
    const executed: number[] = [];
    let requests = 0;
    const model: LLMCaller = { call: async context => {
      assertPaired(context, native);
      if (++requests > 12) return { content: '全部核验完成', finishReason: 'stop' };
      const args = { item: requests };
      return native ? { content: '', finishReason: 'tool_calls', toolCalls: [
        { id: `read-${requests}`, name: 'read', arguments: JSON.stringify(args) },
      ] } : { content: formatTextToolCall('read', args), finishReason: 'stop' };
    } };
    const transform = await meetingCompactionTransform(dataDir, session, 'p:chair');
    const params = { messages, llm: transform(model), tools: { call: async (_tool: string, args: Record<string, unknown>) => {
      executed.push(Number(args.item));
      session.streamingCurrent!.toolCount = executed.length;
      return `资料${args.item}：${'完整核验事实'.repeat(2_000)}`;
    } } };
    const result = native ? await runReActLoopNative({ ...params,
      toolDefs: [{ name: 'read', description: 'Read evidence', parameters: { type: 'object' } }],
    }) : await runReActLoop({ ...params, allowedTools: ['read'] });
    assert.equal(result.termination.status, 'succeeded');
    assert.equal(result.content, '全部核验完成');
    assert.deepEqual(executed, Array.from({ length: 12 }, (_, index) => index + 1));
    assert.ok(summaries() >= 2, 'the same turn completes multiple successful compactions');
    assert.equal(session.streamingCurrent?.compactions?.length, summaries());
    assert.deepEqual(session.publicMessages, originalPublic, 'tool facts do not become fictitious public statements');
    assert.equal(session.publicDisplayHistory, undefined);
    const files = await fs.readdir(path.join(dataDir, 'tradewind', 'compaction', 'meetings'));
    const checkpoints = files.filter(file => file.endsWith('-participant-active.json'));
    assert.equal(checkpoints.length, summaries(), 'each successful boundary has a durable exact model checkpoint');
    for (const file of checkpoints) {
      const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'tradewind', 'compaction', 'meetings', file), 'utf8'));
      assertPaired(saved.context, native);
      assert.ok(saved.context.some((message: ContextMessage) => message.content.includes('完整核验事实')),
        'unsummarized tail tool facts survive the checkpoint');
    }
  });
}

for (const failure of ['cancel', 'commit'] as const) {
  test(`participant ${failure} failure preserves the complete pre-compaction context and has no success boundary`, async t => {
    const abort = new AbortController();
    const { dataDir, session, messages } = await fixture(t, failure === 'cancel'
      ? () => abort.abort(new DOMException('Fixture cancelled', 'AbortError')) : undefined);
    for (let index = 1; index <= 6; index++) messages.push({ role: 'assistant', content: '',
      toolCalls: [{ id: `call-${index}`, name: 'read', arguments: '{}' }] },
    { role: 'tool', content: `资料${index}${'原始事实'.repeat(1_600)}`, toolCallId: `call-${index}` });
    const before = structuredClone(messages);
    if (failure === 'commit') {
      const rename = fs.rename.bind(fs);
      t.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
        if (String(to).endsWith('-participant-active.json')) throw new Error('Fixture commit failed');
        return rename(from, to);
      });
    }
    const transform = await meetingCompactionTransform(dataDir, session, 'p:chair');
    let requests = 0;
    await assert.rejects(callPreparedModel(transform({ call: async () => {
      requests++; return { content: 'Should not run', finishReason: 'stop' };
    } }), messages, abort.signal, {}), failure === 'cancel' ? /Fixture cancelled/ : /Fixture commit failed/);
    assert.equal(requests, 0);
    assert.deepEqual(messages, before);
    assert.equal(session.streamingCurrent?.compactions, undefined);
    assert.equal(session.compactions?.public?.type, 'compact-failed');
    const archiveDir = path.join(dataDir, 'tradewind', 'compaction', 'meetings');
    const files = await fs.readdir(archiveDir);
    assert.ok(!files.some(file => file.endsWith('-participant-active.json')));
    const archived = JSON.parse(await fs.readFile(path.join(archiveDir, files.find(file => file.endsWith('.json'))!), 'utf8'));
    assert.deepEqual(archived.context, before);
  });
}
