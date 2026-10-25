import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeToolOutcome } from './tool-executor.js';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-edit-file-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  const executors = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executors, { recursive: true });
  await fs.mkdir(workspace);
  for (const file of ['edit_file.js', '_resolve.js', '_diff.js']) await fs.copyFile(
    new URL(`../../../data/tools/executors/${file}`, import.meta.url), path.join(executors, file));
  const target = path.join(workspace, 'fixture.txt');
  await fs.writeFile(target, 'old\nold\n');
  const edit = (options: Record<string, unknown>) => executeToolOutcome(dataDir, 'edit_file', {
    filePath: 'fixture.txt', oldString: 'old', newString: '$& new', ...options,
  }, '', workspace, 'project');
  return { target, edit };
}

for (const field of ['replaceAll', 'replace_all']) {
  for (const value of [true, 'true']) {
    test(`edit_file replaces all matches through the local tool boundary: ${field}=${JSON.stringify(value)}`, async t => {
      const { target, edit } = await fixture(t);
      const result = await edit({ [field]: value });
      assert.equal(result.ok, true);
      assert.match(result.result, /替换 2 处/);
      assert.equal(await fs.readFile(target, 'utf8'), '$& new\n$& new\n');
    });
  }
}

for (const value of [undefined, false, 'false', '1', 'yes']) {
  test(`edit_file keeps ambiguous edits blocked when replaceAll is not true: ${String(value)}`, async t => {
    const { target, edit } = await fixture(t);
    await assert.rejects(edit({ replaceAll: value }), /出现 2 次/);
    assert.equal(await fs.readFile(target, 'utf8'), 'old\nold\n');
  });
}
