import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { CycloneAgentReadService } from './agent-read-service.js';

test('Agent 名册仅返回可绑定 ID 和名称，注册表损坏不伪装为空', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = agentRegistryFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const service = new CycloneAgentReadService(root, sources());
  assert.deepEqual((await service.agents()).items, []);
  await writeFile(file, JSON.stringify({ a: { name: '甲', model: 'secret' }, b: { name: '乙' } }));
  assert.deepEqual((await service.agents(1)).items, [{ agentId: 'a', name: '甲' }]);
  await writeFile(file, '{broken');
  await assert.rejects(service.agents(), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_AGENT_REGISTRY_INVALID');
});

test('私聊分页有稳定游标，长消息可续读且历史变化拒绝旧游标', async () => {
  const seat = { id: 'seat-a', updatedAt: 'now', messages: Array.from({ length: 30 }, (_, n) => ({
    role: n % 2 ? 'assistant' : 'user', content: n === 29 ? '长'.repeat(10_000) : `消息 ${n}`,
  })) };
  const service = new CycloneAgentReadService('unused', sources({ seat }));
  const first = await service.thread({ workshopId: 'cyc-a', target: 'seat', targetId: 'seat-a' });
  assert.equal(first.items.length, 24);
  assert.equal(first.items[0]?.index, 6);
  assert.equal(first.items.at(-1)?.content.length, 600);
  const second = await service.thread({ workshopId: 'cyc-a', target: 'seat',
    targetId: 'seat-a', cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.index), [0, 1, 2, 3, 4, 5]);
  const detail = await service.message({ workshopId: 'cyc-a', target: 'seat',
    targetId: 'seat-a', index: 29, revision: first.revision, offset: 6_000 });
  assert.equal(detail.content, '长'.repeat(4_000));
  seat.messages.push({ role: 'user', content: '新消息' });
  await assert.rejects(service.thread({ workshopId: 'cyc-a', target: 'seat',
    targetId: 'seat-a', cursor: first.nextCursor }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_THREAD_CHANGED');
});

function sources(overrides: { seat?: unknown } = {}) {
  return {
    workshops: { list: async () => [] },
    seats: { require: async () => overrides.seat ?? { messages: [] } },
    rooms: { require: async () => ({ publicMessages: [], chairMessages: [] }) },
    chair: { status: async () => ({ messages: [] }) },
  } as never;
}
