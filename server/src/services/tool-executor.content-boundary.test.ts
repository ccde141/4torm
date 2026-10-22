import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeTool } from './tool-executor.js';

test('recursive content search validates every link target and terminates link cycles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'search-content-boundary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const dataDir = path.join(project, 'data');
  const workspace = path.join(project, 'workspace');
  const outside = path.join(root, 'outside');
  const executors = path.join(dataDir, 'tools', 'executors');
  for (const directory of [executors, workspace, outside]) await fs.mkdir(directory, { recursive: true });
  for (const file of ['_resolve.js', 'search_content.js']) await fs.copyFile(
    new URL(`../../../data/tools/executors/${file}`, import.meta.url), path.join(executors, file));
  await fs.writeFile(path.join(workspace, 'local.txt'), 'MATCH local');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'MATCH outside-fixture');
  await fs.symlink(outside, path.join(workspace, 'external'), 'junction');
  await fs.symlink(workspace, path.join(workspace, 'cycle'), 'junction');
  const args = { dirPath: '.', pattern: 'MATCH' };
  const limited = await executeTool(dataDir, 'search_content', args, '', workspace, 'project');
  assert.match(limited, /MATCH local/);
  assert.doesNotMatch(limited, /outside-fixture/);
  assert.equal(limited.split('\n').length, 1);
  const unrestricted = await executeTool(dataDir, 'search_content', args, '', workspace, 'unrestricted');
  assert.match(unrestricted, /outside-fixture/);
  assert.equal(unrestricted.split('\n').length, 2);
});
