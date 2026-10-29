import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMeetingSession } from './meeting-session.js';
import { meetingDisplayMessages } from './meeting-display.js';
import { compactMeetingManually, meetingCompactionTransform, meetingOpeningCaller } from './meeting-context-compaction.js';
import { buildChairContext, compactChairManually } from './chair-context-compaction.js';
import { meetingContextMessages } from './meeting-compaction-context.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/index.js';
import { callPreparedModel } from '../../shared/react/model-call.js';
import { loadAgent } from '../../shared/agent-loader.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-meeting-display-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ chair: { name: 'Chair', model: 'p:chair' } }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://fixture.invalid/v1', models: ['chair'], nativeMode: 'text' }] }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, tradewindConversation: 1_000, tradewindMeeting: 1_000 } });
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify({ choices: [
    { delta: { content: `交接${++calls}：继续核验` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } });
  t.after(() => { globalThis.fetch = previous; });
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: 'Review', chairAgentId: 'chair', participants: [], topic: 'Delivery' });
  session.publicMessages = Array.from({ length: 5 }, (_, index) => [
    { speaker: '人类', content: `Keep this direction ${index}`, timestamp: index * 2 + 1 },
    { speaker: 'Writer', content: `第${index}轮已核验资料`.repeat(500), timestamp: index * 2 + 2 },
  ]).flat();
  return { dataDir, session };
}

test('successive public compactions preserve raw display once while model messages stay compacted', async t => {
  const { dataDir, session } = await fixture(t);
  const original = structuredClone(session.publicMessages);
  await compactMeetingManually(dataDir, session);
  const first = meetingDisplayMessages(session);
  assert.deepEqual(first.slice(0, original.length), original);
  const firstId = first.at(-1)?.compactionId;
  assert.equal(firstId, session.compactions?.public?.id);
  session.publicMessages.push({ speaker: '人类', content: 'Second direction', timestamp: 3 },
    { speaker: 'Writer', content: '新核验资料'.repeat(500), timestamp: 4 });
  await compactMeetingManually(dataDir, session);
  const visible = meetingDisplayMessages(session);
  assert.deepEqual(visible.filter(message => message.speaker === '人类').map(message => message.content),
    [...original.filter(message => message.speaker === '人类').map(message => message.content), 'Second direction']);
  assert.equal(visible.filter(message => message.compactionId).length, 2);
  assert.equal(new Set(visible.flatMap(message => message.compactionId ? [message.compactionId] : [])).size, 2);
  assert.equal(visible.at(-1)?.compactionId, session.compactions?.public?.id);
  const context = meetingContextMessages(session.publicMessages);
  assert.ok(!context.some(message => message.content.includes(original[1].content)));
  assert.ok(context.some(message => message.content.includes(original.at(-1)!.content)));
  assert.deepEqual(meetingDisplayMessages(session), visible);
});

test('in-turn public compaction records offsets on the same full response rather than a global display marker', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages.push({ speaker: '人类', content: 'Current round', timestamp: 3 });
  session.streamingCurrent = { speaker: 'Writer', content: 'Before compaction', reasoning: 'Checked evidence', toolCount: 2 };
  const transform = await meetingCompactionTransform(dataDir, session, 'p:chair');
  const messages = [{ role: 'system' as const, content: 'Identity' }, ...meetingContextMessages(session.publicMessages)];
  await callPreparedModel(transform({ call: async () => ({ content: 'Continue', finishReason: 'stop' }) }), messages, undefined, {});
  const boundary = session.streamingCurrent.compactions?.[0];
  assert.deepEqual(boundary, { id: session.compactions?.public?.id, summary: session.compactions?.public?.summary,
    toolOffset: 2, textOffset: 'Before compaction'.length, reasoningOffset: 'Checked evidence'.length });
  assert.ok(!meetingDisplayMessages(session).some(message => message.compactionId));
  session.publicMessages.push({ speaker: 'Writer', content: 'After compaction', rawContent: 'Before compactionAfter compaction',
    timestamp: 4, compactions: session.streamingCurrent.compactions });
  const visible = meetingDisplayMessages(session);
  assert.equal(visible.at(-1)?.compactions?.[0].id, boundary?.id);
  assert.equal(visible.at(-1)?.rawContent?.slice(0, boundary?.textOffset), 'Before compaction');
});

test('private compaction retains raw messages and stable divider while only the active checkpoint re-enters the model', async t => {
  const { dataDir, session } = await fixture(t);
  session.chairMessages = Array.from({ length: 5 }, (_, index) => [
    { role: 'user' as const, content: `Private direction ${index}` },
    { role: 'assistant' as const, content: `第${index}轮私人核验资料`.repeat(500) },
  ]).flat();
  const original = structuredClone(session.chairMessages);
  const agent = await loadAgent(dataDir, 'chair'); assert.ok(agent);
  await compactChairManually(dataDir, session, agent);
  assert.deepEqual(session.chairMessages.slice(0, original.length), original);
  assert.equal(session.chairMessages.at(-1)?.compactionId, session.compactions?.chair?.id);
  assert.deepEqual(buildChairContext({ role: 'system', content: 'Identity' }, session).slice(1), session.chairActiveContext);
  assert.ok(!session.chairActiveContext?.some(message => message.content.includes(original[1].content)));
  assert.deepEqual(session.chairActiveContext?.slice(1), original.slice(-8));
});

test('opening compaction annotates only its placeholder with a stable turn boundary', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages.push({ speaker: 'Writer', content: '', timestamp: 3, streaming: true });
  const before = structuredClone(session.publicMessages);
  const caller = await meetingOpeningCaller({ call: async () => ({ content: 'Opening reply', finishReason: 'stop' }) },
    dataDir, session, 'p:chair', { nodeId: 'writer', agentId: 'writer', label: 'Writer' });
  await callPreparedModel(caller, [{ role: 'system', content: 'Identity' },
    { role: 'user', content: 'Opening goal', origin: 'framework' },
    ...Array.from({ length: 25 }, (_, index) => ({ role: 'assistant' as const, content: `上游节点资料${index}:${'原'.repeat(2_000)}` })),
    { role: 'user', content: 'Summarize', origin: 'framework' }], undefined, {});
  assert.deepEqual(session.publicMessages.map(({ compactions: _compactions, ...message }) => message), before);
  assert.ok(session.publicMessages.at(-1)?.compactions?.[0].id);
  assert.equal(session.publicMessages.at(-1)?.compactions?.[0].id, session.compactions?.public?.id);
  assert.ok(!session.publicDisplayHistory);
  assert.ok(!session.publicMessages.some(message => message.compactionId));
});
