import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteFile, drainAtomicWrites } from './atomic-io.js';

test('原子写入完整替换目标文件并清理临时文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-'));
  const filePath = path.join(dir, 'state.json');
  await fs.writeFile(filePath, 'old');

  await atomicWriteFile(filePath, '{"ok":true}');

  assert.equal(await fs.readFile(filePath, 'utf-8'), '{"ok":true}');
  await assert.rejects(fs.access(`${filePath}.tmp`));
});

test('并发写同一目标不会争抢临时文件或留下残留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-race-'));
  const filePath = path.join(dir, 'state.json');
  const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ index }));

  await Promise.all(payloads.map(payload => atomicWriteFile(filePath, payload)));

  assert.ok(payloads.includes(await fs.readFile(filePath, 'utf8')));
  const entries = await fs.readdir(dir);
  assert.equal(entries.filter(name => name.endsWith('.tmp')).length, 0);
});

test('排空会等待所有已入队原子写完成', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-drain-'));
  const first = path.join(dir, 'first.json');
  const second = path.join(dir, 'second.json');
  const writes = [
    atomicWriteFile(first, 'first'),
    atomicWriteFile(second, 'second'),
  ];

  await drainAtomicWrites();

  await Promise.all(writes);
  assert.equal(await fs.readFile(first, 'utf8'), 'first');
  assert.equal(await fs.readFile(second, 'utf8'), 'second');
});
