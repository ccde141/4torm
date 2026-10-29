import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConvectionSessionService } from './session-service.js';
import { createModelRequestUsage, observeModelRequests, type ModelRequestUsage } from '../../../engine/shared/model-request-usage.js';
import { withConvectionModelUsage } from '../execution/model-usage.js';

for (const scope of ['public', 'chair'] as const) for (const failed of [false, true]) {
  test(`manual ${scope} compaction ${failed ? 'failure' : 'commit'} keeps scoped durable metering`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-manual-usage-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
      chair: { name: 'Chair', model: 'p:chair' },
    }));
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
      { id: 'p', baseUrl: 'https://manual.test/v1', models: ['chair'] },
    ] }));
    const events: ModelRequestUsage[] = [];
    const service = new ConvectionSessionService(dataDir, undefined, undefined, undefined, undefined,
      (_id, kind, request) => { assert.equal(kind, scope); events.push(request); });
    const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['member'] });
    session.publicMessages = Array.from({ length: 5 }, (_, index) => [
      { speaker: '人类', content: `第${index}轮公共任务原文`.repeat(300), timestamp: index * 2 + 1 },
      { speaker: 'member', content: `已核实的公共资料${index}`.repeat(300), timestamp: index * 2 + 2 },
    ]).flat();
    session.chairMessages = Array.from({ length: 5 }, (_, index) => [
      { role: 'user' as const, content: `助理私聊原文${index}`.repeat(300) },
      { role: 'assistant' as const, content: `私人核验${index}` },
    ]).flat();
    await service.save(session);
    await withConvectionModelUsage(dataDir, session, scope, undefined, async () => {
      const request = createModelRequestUsage({ messages: [{ role: 'user', content: '上一轮输入' }] });
      request.update({ state: 'sent', wasSent: true });
      request.finish('completed', { promptTokens: 50, completionTokens: 10, totalTokens: 60 });
    });
    const previous = globalThis.fetch;
    globalThis.fetch = async () => {
      if (failed) throw new Error('fixture disconnected');
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '已核实任务，继续处理待办。' },
        finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 9, total_tokens: 309 } })}`
        + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    };
    t.after(() => { globalThis.fetch = previous; });
    let parentEvents = 0;
    const run = observeModelRequests(() => { parentEvents++; }, () => scope === 'public'
      ? service.resetContext(session.id, 'summary') : service.changeChairContext(session.id, 'summary'));
    if (failed) await assert.rejects(run, { message: '无法连接模型服务' }); else await run;
    assert.equal(parentEvents, 0);
    assert.ok(events.length >= 3);
    assert.ok(events.every(event => event.purpose === 'compaction'));
    assert.equal(new Set(events.map(event => event.id)).size, failed ? 3 : 1);
    const saved = await service.require(session.id);
    const ledger = saved[scope === 'public' ? 'publicModelUsage' : 'chairModelUsage'];
    assert.equal(ledger?.calls, failed ? 4 : 2);
    if (failed) {
      const attempts = Object.values(ledger!.requests).filter(request => request.purpose === 'compaction');
      assert.equal(attempts.length, 3);
      assert.ok(attempts.every(request => request.state === 'failed' && request.wasSent));
    }
    assert.equal(ledger?.latest?.usage?.promptTokens, 50);
    assert.equal(ledger?.total.totalTokens, failed ? 60 : 369);
    assert.equal(saved[scope === 'public' ? 'chairModelUsage' : 'publicModelUsage'], undefined);
    if (failed) {
      assert.deepEqual(saved.publicMessages, session.publicMessages);
      assert.deepEqual(saved.chairMessages, session.chairMessages);
    } else assert.match(scope === 'public' ? saved.publicMessages[0].content : saved.chairMessages.at(-1)!.content,
      /已核实任务/);
  });
}

test('manual public compaction persists three complete rounds without matching repeated human text', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-retained-human-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair' },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://manual.test/v1', models: ['chair'] },
  ] }));
  const service = new ConvectionSessionService(dataDir);
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicMessages = Array.from({ length: 6 }, (_, index) => [
    { speaker: '人类', content: '继续核验相同问题', timestamp: index * 2 + 1 },
    { speaker: 'member', content: `第${index}轮已核验资料`.repeat(250), timestamp: index * 2 + 2 },
  ]).flat();
  const original = structuredClone(session.publicMessages);
  await service.save(session);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify({ choices: [{
    delta: { content: '已核验资料，继续处理待办。' }, finish_reason: 'stop',
  }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  t.after(() => { globalThis.fetch = previous; });
  await service.resetContext(session.id, 'summary');
  const saved = await service.require(session.id);
  assert.deepEqual(saved.publicMessages.filter(message => message.speaker === '人类').map(({ recordId: _id, ...record }) => record),
    original.filter(message => message.speaker === '人类').slice(-3));
  assert.deepEqual(saved.publicMessages.slice(1).map(({ recordId: _id, ...record }) => record), original.slice(-6));
  assert.equal(saved.publicMessages.length, 7);
});
