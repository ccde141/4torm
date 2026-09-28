import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBackground, loadSkinConfig } from './skin.js';

test('legacy skin config gains texture video defaults without changing its active line background', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { documentElement: { style: { setProperty() {} } } } as unknown as Document;
    globalThis.fetch = async () => new Response(JSON.stringify({ primaryColor: '#ffffff', background: {
      type: 'wind', contour: { speed: 7 }, wind: { speed: 5 },
    } }), { status: 200 });
    const config = await loadSkinConfig();
    assert.equal(config.background?.type, 'wind');
    assert.deepEqual(config.texture?.video, { fit: 'cover', opacity: 0.38, id: undefined });
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; }
});

test('legacy active video migrates to texture without disabling later line selection', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { documentElement: { style: { setProperty() {} } } } as unknown as Document;
    globalThis.fetch = async () => new Response(JSON.stringify({ primaryColor: '#ffffff',
      texture: { layers: ['grid'], opacity: 0.5, blur: 0, blend: 'normal' },
      background: { type: 'video', video: { id: 'background-abc123.mp4', fit: 'contain', opacity: 0.6 } },
    }), { status: 200 });
    const config = await loadSkinConfig();
    assert.equal(config.background?.type, 'none');
    assert.deepEqual(config.texture?.layers, ['grid', 'video']);
    assert.deepEqual(config.texture?.video, { id: 'background-abc123.mp4', fit: 'contain', opacity: 0.6 });
    const withLines = applyBackground('wind');
    assert.equal(withLines.background?.type, 'wind');
    assert.deepEqual(withLines.texture?.layers, ['grid', 'video']);
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; }
});
