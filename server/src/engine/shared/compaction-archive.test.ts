import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareCompactionArchive } from './compaction-archive.js';

test('compaction archive advances its sequence only after an atomic write', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compact-archive-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = { archiveSeq: 3 };

  const result = await prepareCompactionArchive(state, {
    archiveDir: dir,
    fileName: sequence => `round-${sequence}.json`,
    payload: [{ content: 'history' }],
  });

  assert.equal(result.ok, true);
  assert.equal(state.archiveSeq, 4);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'round-4.json'), 'utf8')), [
    { content: 'history' },
  ]);
});

test('compaction archive failure leaves its sequence untouched', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compact-archive-fail-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const blocked = path.join(dir, 'blocked');
  await fs.writeFile(blocked, 'file');
  const state = { archiveSeq: 2 };

  const result = await prepareCompactionArchive(state, {
    archiveDir: path.join(blocked, 'bak'),
    fileName: sequence => `${sequence}.json`,
    payload: [],
  });

  assert.equal(result.ok, false);
  assert.equal(state.archiveSeq, 2);
  if (!result.ok) assert.match(result.error.message, /EEXIST|ENOTDIR/);
});
