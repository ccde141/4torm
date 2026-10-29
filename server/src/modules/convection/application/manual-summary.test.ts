import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSession } from '../infrastructure/session-store.js';
import { retainedConvectionMessages, summarizeConvectionSession } from './manual-summary.js';
import { convectionContext, convectionRecordText } from '../execution/compaction-context.js';

test('manual public compaction keeps three complete human rounds and their tool facts', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-recent-rounds-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ chair: { model: 'p:chair' } }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://summary.invalid/v1', models: ['chair'] },
  ] }));
  const session = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicMessages = Array.from({ length: 5 }, (_, index) => [
    { speaker: '人类', content: `ROUND-${index}`, timestamp: index * 2 },
    { speaker: 'member', content: `已核验的完整资料${index}`.repeat(100), timestamp: index * 2 + 1,
      toolCalls: [{ tool: 'read_file', args: { path: `record-${index}.md` }, result: `证据${index}` }] },
  ]).flat();
  const original = [...session.publicMessages];
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const source = JSON.stringify(body.messages.slice(0, -1)
      .filter((message: { role: string }) => message.role !== 'system'));
    assert.match(source, /ROUND-0/); assert.match(source, /ROUND-1/);
    assert.doesNotMatch(source, /ROUND-2|ROUND-3|ROUND-4/);
    assert.equal(source.match(/read_file/g)?.length, 2, 'each old reply contributes its tool facts once');
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '早期核验已完成。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const result = await summarizeConvectionSession(dataDir, session);
  assert.equal(calls, 1);
  assert.deepEqual(result.retained, original.slice(4));
  assert.equal(result.retained[1], original[5]);
  assert.deepEqual(session.publicMessages, original);
});

test('completed public replies and interrupted replies expose the same observed tool facts', () => {
  const completed = { speaker: 'member', content: '已核验', timestamp: 1,
    toolCalls: [{ tool: 'read_file', args: { path: 'evidence.md' }, result: '实际结果' }] };
  const projected = convectionContext([completed])[0];
  assert.match(projected.content, /evidence\.md/);
  assert.match(projected.content, /实际结果/);
  assert.equal(projected.content.match(/read_file/g)?.length, 1);
  const interrupted = convectionRecordText({ ...completed, execution: { status: 'stopped' } });
  assert.match(interrupted, /已停止/);
  assert.match(interrupted, /实际结果/);
  assert.equal(interrupted.match(/read_file/g)?.length, 1);
});

test('public round protection retains all short discussions and a 30K suffix of autonomous discussion', () => {
  const short = [{ speaker: '人类', content: '请检查', timestamp: 1 },
    { speaker: 'member', content: '已检查', timestamp: 2 }];
  assert.deepEqual(retainedConvectionMessages(short), short);
  const long = Array.from({ length: 20 }, (_, index) => ({
    speaker: 'member', content: `资料${index}:${'原'.repeat(2_000)}`, timestamp: index,
  }));
  const recent = retainedConvectionMessages(long);
  assert.ok(recent.length < long.length);
  assert.ok(recent.length >= 15);
  assert.equal(recent.at(-1), long.at(-1));
});
