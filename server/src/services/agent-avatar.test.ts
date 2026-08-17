import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteAgentAvatar,
  readAgentAvatar,
  saveAgentAvatar,
} from './agent-avatar.js';

const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'),
]);

async function fixture(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-avatar-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { id: 'agent-a', name: 'A' },
  }));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('头像以规范 WebP 原子写入 Agent 私有目录并可删除', async t => {
  const dataDir = await fixture(t);
  const saved = await saveAgentAvatar(dataDir, 'agent-a', `data:image/webp;base64,${WEBP.toString('base64')}`);
  assert.equal(saved.version > 0, true);
  assert.deepEqual(await readAgentAvatar(dataDir, 'agent-a'), WEBP);
  await deleteAgentAvatar(dataDir, 'agent-a');
  await assert.rejects(readAgentAvatar(dataDir, 'agent-a'), /ENOENT/);
});

test('头像拒绝不存在的 Agent、伪造内容与非法标识', async t => {
  const dataDir = await fixture(t);
  const fake = `data:image/webp;base64,${Buffer.from('not-webp').toString('base64')}`;
  await assert.rejects(saveAgentAvatar(dataDir, 'missing', fake), /Agent 不存在/);
  await assert.rejects(saveAgentAvatar(dataDir, 'agent-a', fake), /WebP/);
  await assert.rejects(saveAgentAvatar(dataDir, '../agent-a', fake), /Agent 标识/);
});
