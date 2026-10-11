import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../shared/framework-error.js';
import { ArchiveManager } from './archive-manager.js';

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-archive-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, meta: path.join(dir, 'meta.json'), archive: new ArchiveManager(dir, 'run', 'wf') };
}

function archiveError(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TRADEWIND_ARCHIVE_WRITE_FAILED'
    && error.data.kind === 'io';
}

test('初始归档提交失败真实拒绝而不伪装已开始', async t => {
  const { meta, archive } = await fixture(t);
  await fs.mkdir(meta);
  await assert.rejects(archive.writeStart(), archiveError);
});

test('终态提交失败保留 running；修复 IO 后显式再次提交成功', async t => {
  const { dir, meta, archive } = await fixture(t);
  await archive.writeStart();
  const saved = path.join(dir, 'saved-running.json');
  await fs.rename(meta, saved);
  await fs.mkdir(meta);
  await assert.rejects(archive.writeEnd('done'), archiveError);
  assert.equal(JSON.parse(await fs.readFile(saved, 'utf8')).status, 'running');
  await fs.rmdir(meta);
  await fs.rename(saved, meta);
  await archive.writeEnd('done');
  assert.equal(JSON.parse(await fs.readFile(meta, 'utf8')).status, 'done');
});

test('并发终态提交只保留第一个成功的终态', async t => {
  const { meta, archive } = await fixture(t);
  await archive.writeStart();
  await Promise.all([archive.writeEnd('done'), archive.writeEnd('stopped')]);
  assert.equal(JSON.parse(await fs.readFile(meta, 'utf8')).status, 'done');
});
