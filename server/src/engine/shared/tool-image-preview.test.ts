import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { toolImagePreview } from './tool-image-preview.js';
import { FrameworkError } from './framework-error.js';

test('previews bound decoded dimensions while preserving the supplied original', async () => {
  const source = await sharp({ create: { width: 2400, height: 1600, channels: 3,
    background: '#356791' } }).png().toBuffer();
  const original = Buffer.from(source);
  const preview = await toolImagePreview(source);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 640);
  assert.ok(metadata.height! <= 640);
  assert.ok(preview.length <= 1024 * 1024);
  assert.deepEqual(source, original);
  assert.equal((await sharp(source).metadata()).width, 2400);
});

test('concurrent identical previews reuse one result and retain small image dimensions', async () => {
  const source = await sharp({ create: { width: 40, height: 30, channels: 3,
    background: '#4477aa' } }).png().toBuffer();
  const results = await Promise.all(Array.from({ length: 12 }, () => toolImagePreview(source)));
  assert.ok(results.every(result => result === results[0]));
  const metadata = await sharp(results[0]).metadata();
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 30);
});

test('invalid or oversized-pixel inputs fail without returning original bytes as a preview', async () => {
  for (const source of [Buffer.from('not an image'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"><rect width="100%" height="100%" fill="red"/></svg>')]) {
    await assert.rejects(toolImagePreview(source), error => error instanceof FrameworkError
      && error.data.code === 'TOOL_IMAGE_PREVIEW_UNAVAILABLE');
  }
});

test('preview cache evicts older decoded results instead of accumulating every viewed image', async () => {
  const image = (red: number, green = 53) => sharp({ create: { width: 4, height: 3,
    channels: 3, background: { r: red, g: green, b: 147 } } }).png().toBuffer();
  const first = await image(0, 151);
  const cached = await toolImagePreview(first);
  for (let index = 0; index < 129; index++) await toolImagePreview(await image(index));
  const reloaded = await toolImagePreview(first);
  assert.notEqual(reloaded, cached);
  assert.deepEqual(reloaded, cached);
});

test('preview bursts have bounded pending work and release their slots afterward', async () => {
  const sources = await Promise.all(Array.from({ length: 24 }, (_, index) => sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: index, g: 178, b: 192 } },
  }).png().toBuffer()));
  const results = await Promise.allSettled(sources.map(toolImagePreview));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 18);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.status === 'rejected'
    && result.reason instanceof FrameworkError && result.reason.data.code === 'TOOL_IMAGE_PREVIEW_BUSY'));
  assert.equal((await sharp(await toolImagePreview(sources.at(-1)!)).metadata()).format, 'webp');
});
