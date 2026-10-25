import assert from 'node:assert/strict';
import test from 'node:test';
import { getGlobalDispatcher, type Dispatcher } from 'undici';
import { inferenceDispatcher } from './inference-transport.js';

test('inference keeps the configured dispatcher and disables only its response header/body clocks', t => {
  const original: Dispatcher.DispatchOptions = { origin: 'http://localhost', path: '/model', method: 'POST',
    headersTimeout: 1_000, bodyTimeout: 2_000 };
  const dispatcher = getGlobalDispatcher();
  let received: Dispatcher.DispatchOptions | undefined;
  t.mock.method(dispatcher, 'dispatch', (options: Dispatcher.DispatchOptions) => { received = options; return true; });
  assert.equal(inferenceDispatcher.dispatch(original, { onError: () => {} }), true);
  assert.equal(getGlobalDispatcher(), dispatcher);
  assert.deepEqual(received, { ...original, headersTimeout: 0, bodyTimeout: 0 });
  assert.equal(original.headersTimeout, 1_000); assert.equal(original.bodyTimeout, 2_000);
});
