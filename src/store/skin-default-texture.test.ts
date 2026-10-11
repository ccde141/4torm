import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_TEXTURE } from './skin-config.js';
import { clearCustomTexture, loadSkinConfig, uploadCustomTexture } from './skin.js';

test('default skin texture resolves to a bundled PNG', async () => {
  const asset = DEFAULT_TEXTURE.customPath;
  assert.ok(asset);
  assert.ok(DEFAULT_TEXTURE.layers.includes('custom'));
  const url = new URL(DEFAULT_TEXTURE.customImage!, 'http://localhost');
  assert.equal(url.pathname, '/api/storage/file');
  assert.equal(url.searchParams.get('path'), asset);
  const bytes = await readFile(new URL(`../../data/${asset}`, import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('replacing or clearing the default texture preserves the bundled PNG', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalFileReader = globalThis.FileReader;
  const deleted: string[] = [];
  class FakeReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(): void {
      this.result = 'data:image/png;base64,YQ==';
      queueMicrotask(() => this.onload?.());
    }
  }
  try {
    globalThis.document = { documentElement: { style: { setProperty() {} } } } as unknown as Document;
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    globalThis.fetch = async input => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/storage/read') return new Response('null');
      if (url.pathname === '/api/storage/delete') deleted.push(url.searchParams.get('path') ?? '');
      return new Response('{}');
    };
    await loadSkinConfig();
    clearCustomTexture();
    await loadSkinConfig();
    await uploadCustomTexture(new File(['x'], 'replacement.png', { type: 'image/png' }));
    assert.ok(!deleted.includes(DEFAULT_TEXTURE.customPath!));
    await new Promise(resolve => setTimeout(resolve, 300));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.FileReader = originalFileReader;
  }
});
