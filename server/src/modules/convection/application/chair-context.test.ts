import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConvectionSessionService } from './session-service.js';
import { buildConvectionChairContext, convectionChairBoundaries, rememberChairContextBoundary } from '../execution/chair-context.js';
import { sessionWorkspace } from '../infrastructure/session-store.js';
import type { ConvectionCompactionSink } from './compaction-progress.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/contracts.js';

test('助理公共观察仅按完整会议轮次分割，私聊只在下一次人类输入前分割', () => {
  const messages = [{ role: 'system' as const, content: '身份' },
    ...['[公共会议：人类] 问题', '[公共会议：成员A] 答复', '[公共会议：成员B] 答复',
      '[公共会议：人类] 第二轮', '[公共会议：成员A] 回答', '私聊问题'].map(content => ({ role: 'user' as const, content })),
    { role: 'assistant' as const, content: '私聊答复' }, { role: 'user' as const, content: '继续私聊' }];
  assert.deepEqual(convectionChairBoundaries(messages), [4, 6, 8, 9]);
});

async function fixture(t: test.TestContext, onCompaction?: ConvectionCompactionSink) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-chair-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair', config: { compactionPrompt: '保留公私来源区别' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['chair'] },
  ] }));
  const service = new ConvectionSessionService(dataDir, undefined, undefined, undefined, onCompaction);
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicMessages = [{ speaker: '人类', content: '公共目标'.repeat(500), timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: '私人疑问'.repeat(500) }];
  session.chairActiveContext = [{ role: 'system', content: '旧摘要' }];
  rememberChairContextBoundary(session);
  await service.save(session);
  return { dataDir, service, session };
}

test('助理 /reset 清除实际上下文，公共会议 /reset 不再残留助理压缩引用', async t => {
  const { service, session } = await fixture(t);
  await service.changeChairContext(session.id, 'clean');
  let saved = await service.require(session.id);
  assert.equal(saved.chairActiveContext, undefined);
  const request = buildConvectionChairContext(saved, { role: 'system', content: '静态身份' });
  assert.doesNotMatch(JSON.stringify(request), /旧摘要|私人疑问/);
  assert.match(JSON.stringify(request), /公共目标/);
  saved.chairActiveContext = [{ role: 'system', content: '不得重新进入上下文' }];
  await service.save(saved);
  await service.resetContext(session.id, 'clean');
  saved = await service.require(session.id);
  assert.deepEqual(buildConvectionChairContext(saved, { role: 'system', content: '静态身份' }),
    [{ role: 'system', content: '静态身份' }]);
});

test('助理 /compact 全量压缩公共观察与私聊，原文归档且公共会议不被改写', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const progress: CompactionProgress[] = [];
  const { dataDir, service, session } = await fixture(t,
    (_id, _scope, event) => progress.push(structuredClone(event)));
  session.chairActiveContext = undefined;
  await service.save(session);
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'chair');
    assert.equal(body.stream, true);
    assert.match(JSON.stringify(body.messages), /保留公私来源区别/);
    assert.match(JSON.stringify(body.messages), /公共目标/);
    assert.match(JSON.stringify(body.messages), /私人疑问/);
    assert.equal((await fs.readdir(path.join(sessionWorkspace(dataDir, session.id), 'bak'))).length, 1);
    await Promise.resolve();
    now += 12_000;
    const chunk = { choices: [{ delta: { content: '公共目标与私人疑问已区分。' }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  t.after(() => { globalThis.fetch = previous; });
  const result = await service.changeChairContext(session.id, 'summary');
  const saved = await service.require(session.id);
  assert.deepEqual(saved.publicMessages, session.publicMessages);
  const archive = JSON.parse(await fs.readFile(path.join(sessionWorkspace(dataDir, session.id), 'bak', result.archived), 'utf8'));
  assert.equal(archive.publicMessages[0].content, session.publicMessages[0].content);
  assert.equal(archive.chairMessages[0].content, session.chairMessages[0].content);
  const request = buildConvectionChairContext(saved, { role: 'system', content: '静态身份' });
  assert.equal(request.length, 2);
  assert.match(request[1].content, /公共目标与私人疑问已区分/);
  assert.equal(saved.chairCompactionProgress?.startedAt, now - 12_000);
  assert.equal(saved.chairCompactionProgress?.updatedAt, now);
  assert.deepEqual(progress.at(-1), saved.chairCompactionProgress);
});
