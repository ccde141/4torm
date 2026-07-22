import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeSeasonSession, type TideSession } from './session-store.js';

test('指定季风会话写入保持元信息索引格式', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-season-index-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const dir = path.join(dataDir, 'agents', 'agent-a', 'sessions');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '_index.json'), JSON.stringify([
    { i: 'session-a', t: '旧标题', u: '2026-01-01T00:00:00.000Z', r: 'read-marker' },
  ]));

  const session: TideSession = {
    id: 'session-a', agentId: 'agent-a', agentName: 'Agent A', title: '新标题',
    messages: [], model: 'provider:model', systemPrompt: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  };
  await writeSeasonSession(dataDir, session);

  const index = JSON.parse(await fs.readFile(path.join(dir, '_index.json'), 'utf8'));
  assert.deepEqual(index, [{
    i: 'session-a', t: '新标题', u: '2026-01-02T00:00:00.000Z',
    r: 'read-marker', n: 'Agent A',
  }]);
});
