import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readJsonFile } from './json-file-store.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), '4torm-json-store-'));
}

test('readJsonFile returns parsed JSON and accepts UTF-8 BOM', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, '\uFEFF{"ok":true}', 'utf8');

  assert.deepEqual(await readJsonFile<{ ok: boolean }>(file, 'test'), { ok: true });
});

test('readJsonFile returns null only when target is missing', async () => {
  const dir = await createTempDir();

  assert.equal(await readJsonFile(path.join(dir, 'missing.json'), 'test'), null);
  await assert.rejects(readJsonFile(dir, 'test'));
});

test('readJsonFile quarantines corrupt JSON and returns null', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, '{broken', 'utf8');

  assert.equal(await readJsonFile(file, 'test'), null);
  await assert.rejects(fs.access(file));
  const entries = await fs.readdir(dir);
  assert.equal(entries.filter(name => name.startsWith('state.json.corrupt-')).length, 1);
});
