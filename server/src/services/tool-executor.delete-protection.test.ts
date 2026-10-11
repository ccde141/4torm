import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { executeTool } from './tool-executor.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-delete-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  for (const file of ['_resolve.js', 'delete_file.js']) {
    await fs.copyFile(new URL(`../../../data/tools/executors/${file}`, import.meta.url),
      path.join(executorDir, file));
  }
  const contents = {
    'agents/registry.json': '{}', 'tools/registry.json': '[]', 'tide/tasks.json': '[]',
    'skills/review/executors/tool.js': 'export default () => "ok";',
    'tradewind/workflows/wf-a/graph.json': '{}',
  };
  for (const [file, content] of Object.entries(contents)) {
    await fs.mkdir(path.dirname(path.join(dataDir, file)), { recursive: true });
    await fs.writeFile(path.join(dataDir, file), content);
  }
  const remove = (target: string, level: 'project' | 'unrestricted' = 'unrestricted') =>
    executeTool(dataDir, 'delete_file', { filePath: target }, '', workspace, level);
  return { root, dataDir, workspace, remove };
}

test('recursive parent deletion cannot bypass control-file protection in either permission mode', async (t) => {
  const f = await fixture(t);
  for (const level of ['project', 'unrestricted'] as const) {
    await assert.rejects(f.remove(path.join(f.dataDir, 'agents', 'registry.json'), level), /控制文件/);
    for (const relative of ['', 'agents', 'tools', 'skills', 'tradewind', 'tradewind/workflows']) {
      await assert.rejects(f.remove(path.join(f.dataDir, relative), level), /控制文件|受保护/);
    }
    await assert.rejects(f.remove(f.root, level), /控制文件|受保护/);
  }
  assert.equal(await fs.readFile(path.join(f.dataDir, 'agents', 'registry.json'), 'utf8'), '{}');
});

test('executor directories cannot remove protected files through an ancestor', async (t) => {
  const f = await fixture(t);
  for (const relative of ['tools/executors', 'skills/review', 'skills/review/executors']) {
    await assert.rejects(f.remove(path.join(f.dataDir, relative)), /控制文件|受保护|已有工具执行器/);
  }
  const nested = path.join(f.dataDir, 'tools', 'executors', 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'existing.js'), 'export default () => "ok";');
  await assert.rejects(f.remove(nested), /受保护|已有工具执行器/);
  await fs.access(path.join(nested, 'existing.js'));
});

test('ordinary and feature workspaces retain recursive deletion and missing-file idempotence', async (t) => {
  const f = await fixture(t);
  for (const workspace of [f.workspace,
    path.join(f.dataDir, 'agents', 'agent-a', '.workspace'),
    path.join(f.dataDir, 'tradewind', 'workflows', 'wf-a', 'workspace')]) {
    await fs.mkdir(path.join(workspace, 'generated', 'deep'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'generated', 'deep', 'output.txt'), 'result');
    await f.remove(path.join(workspace, 'generated'), 'project');
    await assert.rejects(fs.access(path.join(workspace, 'generated')), { code: 'ENOENT' });
    await f.remove(path.join(workspace, 'generated'), 'project');
  }
  await fs.access(path.join(f.dataDir, 'tradewind', 'workflows', 'wf-a', 'graph.json'));
});

test('junction aliases cannot bypass protected ancestor checks', async (t) => {
  const f = await fixture(t);
  const dataAlias = path.join(f.workspace, 'data-link');
  const executorAlias = path.join(f.workspace, 'executor-link');
  await fs.symlink(f.dataDir, dataAlias, 'junction');
  await fs.symlink(path.join(f.dataDir, 'skills', 'review', 'executors'), executorAlias, 'junction');
  await assert.rejects(f.remove(dataAlias), /控制文件|受保护/);
  await assert.rejects(f.remove(executorAlias), /受保护|已有工具执行器/);
  await fs.access(path.join(f.dataDir, 'tide', 'tasks.json'));
});

test('a linked data directory is protected through both its configured path and its real parent', async (t) => {
  const f = await fixture(t);
  const realParent = path.join(f.root, 'storage');
  const realData = path.join(realParent, 'data');
  await fs.mkdir(realParent);
  await fs.rename(f.dataDir, realData);
  await fs.symlink(realData, f.dataDir, 'junction');
  await assert.rejects(f.remove(f.root), /控制文件|受保护/);
  await assert.rejects(f.remove(realParent), /控制文件|受保护/);
  await assert.rejects(f.remove(f.dataDir), /控制文件|受保护/);
  await fs.access(path.join(realData, 'tide', 'tasks.json'));
});
