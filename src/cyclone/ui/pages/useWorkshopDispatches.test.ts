import assert from 'node:assert/strict';
import test from 'node:test';
import { readDispatchError } from './useWorkshopDispatches.js';

test('派发错误保留服务端正文并只本地化 fallback', async () => {
  const serverError = await readDispatchError(
    new Response(JSON.stringify({ error: '模型正忙' }), { status: 409 }),
    'Dispatch request failed (HTTP 409)',
  );
  assert.equal(serverError.message, '模型正忙');

  const fallbackError = await readDispatchError(
    new Response('{}', { status: 503 }),
    'Dispatch request failed (HTTP 503)',
  );
  assert.equal(fallbackError.message, 'Dispatch request failed (HTTP 503)');
});
