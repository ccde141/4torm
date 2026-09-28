import assert from 'node:assert/strict';
import test from 'node:test';
import { persistSkinConfig } from './skin-persistence.js';
import type { SkinConfig } from './skin.js';

test('skin persistence serializes older and newer snapshots', async () => {
  const originalFetch = globalThis.fetch;
  const writes: string[] = [];
  let releaseFirst: (() => void) | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      writes.push(String(init?.body));
      if (writes.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      return new Response('{}', { status: 200 });
    };
    const old = persistSkinConfig({ primaryColor: '#111111' } as SkinConfig);
    const next = persistSkinConfig({ primaryColor: '#222222' } as SkinConfig);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(writes.length, 1);
    releaseFirst?.();
    await Promise.all([old, next]);
    assert.match(writes[0] ?? '', /#111111/);
    assert.match(writes[1] ?? '', /#222222/);
  } finally { globalThis.fetch = originalFetch; }
});
