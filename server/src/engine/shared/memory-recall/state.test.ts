import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRecallState, recallStateFile, changeRecallState } from './state.js';
import { stageRecallCards, reusableRecallPending } from './pending.js';
import type { RecallSessionState, RecallPending } from './contracts.js';

const scope = { agentId: 'a', sessionId: 's' };
const item: RecallPending = { id: 'memory:style', revision: 'v1', level: 'L2', kind: 'memory', title: '青禾界面',
  text: '轻玻璃卡片，避免黑色背景。', status: 'ready', preparedFor: 'original-input', preparedAt: '2026-11-01T00:00:00Z',
  context: [{ role: 'user', content: '青禾资料站的卡片界面' }] };
const initial: RecallSessionState = { version: 2, owner: scope, inputKey: 'next-input', query: '继续', status: 'queued',
  updatedAt: '2026-11-01T00:01:00Z', cards: [], pending: [item], deliveries: [] };

test('shelving retains provenance and staging preserves the original preparation identity', () => {
  const reusable = reusableRecallPending('继续', [], [item]); assert.equal(reusable.length, 1);
  const staged = stageRecallCards(initial, [item], reusable, []);
  assert.equal(staged.pending?.[0].preparedFor, 'original-input'); assert.equal(staged.pending?.[0].status, 'staged');
  assert.equal(staged.deliveries?.[0].inputKey, 'next-input');
  assert.deepEqual(reusableRecallPending('换个话题，聊聊晚餐', [], [item]), []);
  assert.equal(stageRecallCards(initial, [], [], []).pending?.[0].status, 'shelved');
});

test('legacy ready state migrates without discarding sources; malformed state is preserved and never replaced', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-state-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const file = recallStateFile(dataDir, scope); await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ version: 1, inputKey: 'old', query: '青禾', status: 'ready',
    updatedAt: initial.updatedAt, cards: [item] }));
  const migrated = await loadRecallState(dataDir, scope);
  assert.equal(migrated?.version, 2); assert.equal(migrated?.pending?.[0].id, item.id);
  assert.deepEqual(migrated?.owner, scope);
  await fs.writeFile(file, '{invalid');
  await assert.rejects(changeRecallState(dataDir, scope, undefined, () => initial), /CORRUPT/);
  assert.equal(await fs.readFile(file, 'utf8'), '{invalid');
});
