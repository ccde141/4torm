import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistMcpToolOutcome, readToolImage, readToolImageRefs } from './tool-media-store.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
const image = { mimeType: 'image/png', data: PNG };
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('图片原子保存为UUID引用，重读恢复相同像素且持久结果没有inline/base64', async t => {
  const root = await fixture(t);
  const outcome = await persistMcpToolOutcome(root, { result: '原始文字', ok: false, inlineImages: [image], structuredContent: { count: 1 } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.result, '原始文字');
  assert.deepEqual(outcome.structuredContent, { count: 1 });
  assert.equal('inlineImages' in outcome, false);
  assert.doesNotMatch(JSON.stringify(outcome), /dataUrl|base64|iVBOR/);
  const ref = outcome.toolImages![0];
  assert.match(ref.id, /^[0-9a-f-]{36}$/);
  assert.equal(ref.size, 8);
  assert.equal((await readToolImage(root, ref)).dataUrl, `data:image/png;base64,${PNG}`);
  const reloaded = await persistMcpToolOutcome(root, JSON.parse(JSON.stringify(outcome)));
  assert.deepEqual(reloaded, outcome);
  assert.equal((await fs.readdir(path.join(root, 'mcp', 'media'))).length, 1);
});

test('图像数量、类型、编码与8MiB限制明确降级，文字和真实工具状态不丢失', async t => {
  const root = await fixture(t);
  const capped = await persistMcpToolOutcome(root, { result: '保留文字', ok: true, inlineImages: Array.from({ length: 5 }, () => image) });
  assert.equal(capped.toolImages?.length, 4);
  assert.match(capped.result, /4 张上限/);
  const failed = await persistMcpToolOutcome(root, { result: '保留文字', ok: true, inlineImages: [
    { mimeType: 'image/svg+xml', data: 'SVG_BYTES' }, { mimeType: 'image/png', data: 'NOT_BASE64' },
    { mimeType: 'image/png', data: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') },
  ] });
  assert.equal(failed.ok, true);
  assert.equal(failed.toolImages, undefined);
  assert.match(failed.result, /保留文字/);
  assert.match(failed.result, /类型不受支持/);
  assert.match(failed.result, /8 MiB/);
  assert.doesNotMatch(failed.result, /SVG_BYTES|NOT_BASE64/);
  assert.equal('inlineImages' in failed, false);
});

test('存储失败不伪造可用引用，引用重读校验类型大小、签名与路径', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'mcp'));
  await fs.writeFile(path.join(root, 'mcp', 'media'), 'not a directory');
  const failed = await persistMcpToolOutcome(root, { result: '已执行', ok: true, inlineImages: [image] });
  assert.match(failed.result, /已执行[\s\S]*图片未保存/);
  assert.equal(failed.toolImages, undefined);
  await fs.rm(path.join(root, 'mcp', 'media'));
  const outcome = await persistMcpToolOutcome(root, { result: '', ok: true, inlineImages: [image] });
  const ref = outcome.toolImages![0];
  await assert.rejects(readToolImage(root, { ...ref, size: ref.size + 1 }), /大小/);
  await fs.writeFile(path.join(root, 'mcp', 'media', `${ref.id}.png`), Buffer.alloc(8));
  await assert.rejects(readToolImage(root, ref), /内容与引用/);
  for (const value of [null, [{ ...ref, id: '../outside' }], [{ ...ref, dataUrl: 'data:image/png;base64,bytes' }], [{ ...ref, mimeType: 'image/svg+xml' }]]) {
    assert.throws(() => readToolImageRefs(value), /引用/);
  }
  assert.deepEqual(readToolImageRefs(undefined), []);
});

test('媒体目录junction不能将工具图片写到数据根外', async t => {
  const root = await fixture(t);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.mkdir(path.join(root, 'mcp'));
  await fs.symlink(outside, path.join(root, 'mcp', 'media'), process.platform === 'win32' ? 'junction' : 'dir');
  const outcome = await persistMcpToolOutcome(root, { result: '保留', ok: true, inlineImages: [image] });
  assert.match(outcome.result, /未保存/);
  assert.deepEqual(await fs.readdir(outside), []);
});
