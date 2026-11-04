import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { memoryRoutes } from './memory.js';

test('memory endpoints preserve tiers and summaries and report stale update/delete as conflicts', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-routes-'));
  const app = Fastify(); app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  await app.register(memoryRoutes, { prefix: '/api/memory' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const post = (action: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/memory/${action}`, payload });
  const created = await post('create', { agentId: 'a', summary: '项目甲', detail: '最初内容', category: 'fact', tier: 'frequent' });
  assert.equal(created.statusCode, 200);
  const { slug } = created.json();
  const [first] = (await app.inject('/api/memory/list?agentId=a')).json();
  assert.equal(first.tier, 'frequent');
  const updated = await post('update', { agentId: 'a', slug, summary: '更新摘要', detail: '合并后的内容', tier: 'archived', expectedUpdated: first.updated });
  assert.equal(updated.statusCode, 200); assert.equal(updated.json().summary, '更新摘要');
  assert.equal((await post('update', { agentId: 'a', slug, detail: '旧内容覆盖', expectedUpdated: first.updated })).statusCode, 409);
  assert.equal((await post('delete', { agentId: 'a', slug, expectedUpdated: first.updated })).statusCode, 409);
  const [latest] = (await app.inject('/api/memory/list?agentId=a')).json();
  assert.equal(latest.slug, slug); assert.equal(latest.tier, 'archived'); assert.equal(latest.detail, '合并后的内容');
  assert.equal((await post('delete', { agentId: 'a', slug, expectedUpdated: latest.updated })).statusCode, 200);
  assert.deepEqual((await app.inject('/api/memory/list?agentId=a')).json(), []);
});
