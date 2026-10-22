import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { convectionSessionIndexFile } from '../../../services/data-paths.js';
import { createSession, listSessions, loadSession } from './session-store.js';

async function temporaryData(t: TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-store-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('对流会话并发创建不会丢失索引项', async t => {
  const dataDir = await temporaryData(t);
  const sessions = await Promise.all(Array.from({ length: 8 }, (_, index) => createSession(dataDir, {
    chairAgentId: `chair-${index}`,
    participantAgentIds: [`agent-${index}`],
    title: `session-${index}`,
  })));
  const listed = await listSessions(dataDir);
  assert.deepEqual(
    new Set(listed.map(item => item.id)),
    new Set(sessions.map(item => item.id)),
  );
});

test('对流索引损坏时真实失败并隔离原文件', async t => {
  const dataDir = await temporaryData(t);
  const indexFile = convectionSessionIndexFile(dataDir);
  await fs.mkdir(path.dirname(indexFile), { recursive: true });
  await fs.writeFile(indexFile, '{broken', 'utf8');
  await assert.rejects(listSessions(dataDir), error => (
    typeof error === 'object' && error !== null
    && 'data' in error
    && (error as { data?: { code?: string } }).data?.code === 'CONVECTION_STORE_CORRUPT'
  ));
  const files = await fs.readdir(path.dirname(indexFile));
  assert.ok(files.some(file => file.startsWith('_index.json.corrupt-')));
});

test('隔离的损坏索引跨实例仍失败，不能以新会话覆盖旧目录', async t => {
  const dataDir = await temporaryData(t);
  const old = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const file = convectionSessionIndexFile(dataDir);
  await fs.writeFile(file, '{broken');
  const corrupt = (error: unknown) => (error as { data?: { code?: string } }).data?.code
    === 'CONVECTION_STORE_CORRUPT';
  await assert.rejects(listSessions(dataDir), corrupt);
  await assert.rejects(listSessions(dataDir), corrupt);
  await assert.rejects(createSession(dataDir, {
    chairAgentId: 'chair', participantAgentIds: ['agent'],
  }), corrupt);
  assert.equal((await loadSession(dataDir, old.id))?.id, old.id);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.json')),
    [`${old.id}.json`]);
  await fs.writeFile(file, JSON.stringify([old.id]));
  assert.deepEqual((await listSessions(dataDir)).map(item => item.id), [old.id]);
});

test('主文件已提交但索引遗漏时重建投影，后续创建保留旧会话', async t => {
  const dataDir = await temporaryData(t);
  const original = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const indexFile = convectionSessionIndexFile(dataDir);
  await fs.writeFile(indexFile, '[]');
  assert.deepEqual((await listSessions(dataDir)).map(item => item.id), [original.id]);
  await fs.rm(indexFile);
  const next = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['agent'] });
  assert.deepEqual(new Set((await listSessions(dataDir)).map(item => item.id)), new Set([original.id, next.id]));
  assert.deepEqual(new Set(JSON.parse(await fs.readFile(indexFile, 'utf8'))), new Set([original.id, next.id]));
});

test('重建遇到损坏的孤儿主文件持续报错并保留原数据', async t => {
  const dataDir = await temporaryData(t);
  const original = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const indexFile = convectionSessionIndexFile(dataDir);
  await fs.writeFile(indexFile, '[]');
  await fs.writeFile(path.join(path.dirname(indexFile), `${original.id}.json`), '{damaged');
  await assert.rejects(listSessions(dataDir), /损坏/);
  await assert.rejects(listSessions(dataDir), /隔离/);
  assert.equal(await fs.readFile(indexFile, 'utf8'), '[]');
});
