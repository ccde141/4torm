import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeToolOutcome, ToolPermissionError } from './tool-executor.js';
import { readToolImage } from '../engine/shared/tool-media-store.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=', 'base64');

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-read-image-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'project', 'data');
  const workspace = path.join(root, 'project', 'workspace');
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'agents'));
  await fs.mkdir(workspace);
  for (const file of ['read_image.js', '_resolve.js']) await fs.copyFile(
    new URL(`../../../data/tools/executors/${file}`, import.meta.url), path.join(dataDir, 'tools', 'executors', file));
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { id: 'worker', config: { toolMode: 'selected', tools: ['read_image'] } },
  }));
  await fs.writeFile(path.join(workspace, 'pixel.bin'), PNG);
  const read = (filePath = 'pixel.bin', level: 'project' | 'unrestricted' = 'project') =>
    executeToolOutcome(dataDir, 'read_image', { filePath }, 'worker', workspace, level);
  return { root, dataDir, workspace, read };
}

test('read_image returns durable pixels without base64 in history or tool events', async t => {
  const f = await fixture(t);
  const outcome = await f.read();
  assert.equal(outcome.ok, true);
  assert.equal(outcome.toolImages?.length, 1);
  assert.equal(outcome.toolImages[0].mimeType, 'image/png');
  assert.doesNotMatch(JSON.stringify(outcome), /inlineImages|base64|iVBOR/);
  const restored = await readToolImage(f.dataDir, outcome.toolImages[0]);
  assert.equal(restored.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
});

test('read_image preserves file access boundaries, including links outside the project', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  const image = path.join(outside, 'private-fixture.png');
  await fs.writeFile(image, PNG);
  await fs.symlink(outside, path.join(f.workspace, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.read(image), /项目级权限/);
  await assert.rejects(f.read('external/private-fixture.png'), /项目级权限/);
  assert.equal((await f.read(image, 'unrestricted')).toolImages?.length, 1);
});

test('read_image rejects unsupported, oversized and missing input without publishing references', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.workspace, 'text.png'), 'this is not a picture');
  await fs.writeFile(path.join(f.workspace, 'large.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(f.read('text.png'), /格式不受支持/);
  await assert.rejects(f.read('large.png'), /8 MiB/);
  await assert.rejects(f.read('missing.png'), /ENOENT/);
  await assert.rejects(f.read('.'), /图片文件/);
  await assert.rejects(fs.access(path.join(f.dataDir, 'mcp', 'media')));
});

test('read_image requires current Agent tool authorization', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { id: 'worker', config: { toolMode: 'selected', tools: [] } },
  }));
  await assert.rejects(f.read(), ToolPermissionError);
});
