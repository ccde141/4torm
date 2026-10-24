import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSession, loadSession, listSessions } from '../infrastructure/session-store.js';
import { createModelRequestUsage } from '../../../engine/shared/model-request-usage.js';
import { withConvectionModelUsage } from './model-usage.js';

test('公聊请求失败后从独立计量事实恢复，已知用量不依赖最终回答落盘', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-request-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const session = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: [] });
  const events: string[] = [];
  await assert.rejects(withConvectionModelUsage(dataDir, session, 'public', event => events.push(event.type), async () => {
    const request = createModelRequestUsage({ messages: [{ role: 'user', content: '读取资料并核实' }],
      tools: [{ name: 'read_file', description: '读取指定文件' }] });
    request.update({ state: 'sent', wasSent: true });
    request.report({ promptTokens: 200, completionTokens: 8, totalTokens: 208 });
    request.report({ promptTokens: 200, completionTokens: 8, totalTokens: 208 });
    request.finish('failed');
    throw new Error('fixture disconnected');
  }), /fixture disconnected/);
  assert.equal(events.length, 5);
  const reloaded = await loadSession(dataDir, session.id);
  assert.equal(reloaded?.publicMessages.length, 0);
  assert.equal(reloaded?.publicModelUsage?.calls, 1);
  assert.equal(reloaded?.publicModelUsage?.total.totalTokens, 208);
  assert.equal(reloaded?.publicModelUsage?.complete, false);
  assert.equal(reloaded?.chairModelUsage, undefined);
  assert.equal((await listSessions(dataDir))[0].publicModelUsage?.total.totalTokens, 208);
});

test('会议助理与公聊分别累计，压缩请求不会冒充主请求输入', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-request-scope-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const session = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: [] });
  await withConvectionModelUsage(dataDir, session, 'chair', undefined, async () => {
    const main = createModelRequestUsage({ messages: [{ role: 'user', content: '整理讨论' }] });
    main.update({ state: 'sent', wasSent: true });
    main.finish('completed', { promptTokens: 50, completionTokens: 10, totalTokens: 60 });
    const compact = createModelRequestUsage({ messages: [{ role: 'user', content: '压缩历史' }] }, 'compaction');
    compact.update({ state: 'sent', wasSent: true });
    compact.finish('completed', { promptTokens: 20, completionTokens: 4, totalTokens: 24 });
  });
  const saved = await loadSession(dataDir, session.id);
  assert.equal(saved?.publicModelUsage, undefined);
  assert.equal(saved?.chairModelUsage?.total.totalTokens, 84);
  assert.equal(saved?.chairModelUsage?.latest?.purpose, 'conversation');
  assert.equal(saved?.chairModelUsage?.latest?.usage?.promptTokens, 50);
});
