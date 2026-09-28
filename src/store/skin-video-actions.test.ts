import assert from 'node:assert/strict';
import test from 'node:test';
import { getSkinConfig, loadSkinConfig, type SkinConfig } from './skin.js';
import { DEFAULT_BACKGROUND } from './skin-background.js';
import { DEFAULT_VIDEO } from './skin-video-config.js';
import { removeBackgroundVideo, replaceBackgroundVideo } from './skin-video-actions.js';

test('replacing video persists the new choice before deleting old media; delete failure restores it', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let stored: SkinConfig = { primaryColor: '#ffffff', secondaryColor: '#a9f8fe',
    background: { ...DEFAULT_BACKGROUND, type: 'wind' },
    texture: { layers: ['video'], opacity: 0.5, blur: 0, blend: 'normal',
      video: { ...DEFAULT_VIDEO, id: 'background-abc123.mp4', opacity: 0.4 } },
  };
  const deleted: string[] = [];
  let failDelete = false;
  try {
    globalThis.document = { documentElement: { style: { setProperty() {} } } } as unknown as Document;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/storage/read')) return new Response(JSON.stringify(stored), { status: 200 });
      if (url.startsWith('/api/storage/write')) {
        stored = JSON.parse(String(init?.body)) as SkinConfig;
        return new Response('{}', { status: 200 });
      }
      if (url === '/api/skin-video' && init?.method === 'PUT') {
        return new Response(JSON.stringify({ id: 'background-def456.mp4' }), { status: 200 });
      }
      if (url.startsWith('/api/skin-video/') && init?.method === 'DELETE') {
        deleted.push(url);
        return new Response('{}', { status: failDelete ? 500 : 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    await loadSkinConfig();
    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    await replaceBackgroundVideo(file, () => {});
    assert.equal(stored.texture?.video?.id, 'background-def456.mp4');
    assert.equal(stored.background?.type, 'wind');
    assert.deepEqual(deleted, ['/api/skin-video/background-abc123.mp4']);

    failDelete = true;
    await assert.rejects(removeBackgroundVideo(() => {}), /视频删除失败/);
    assert.equal(stored.texture?.video?.id, 'background-def456.mp4');
    assert.equal(getSkinConfig().texture?.video?.id, 'background-def456.mp4');
    await new Promise(resolve => setTimeout(resolve, 300));
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; }
});
