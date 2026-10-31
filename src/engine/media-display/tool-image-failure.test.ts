import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMessage } from '../../i18n/locale';
import { inspectToolImageFailure, toolImageFailureKey } from './tool-image-failure';

test('image failures check only HEAD and distinguish missing, denied, authentication and unavailable previews', async () => {
  for (const [status, expected] of [[404, 'missing'], [410, 'missing'], [403, 'forbidden'],
    [401, 'authentication'], [400, 'unavailable'], [500, 'unavailable'], [200, 'unavailable']] as const) {
    const response = new Response('No image bytes should be read', { status });
    let method: string | undefined;
    const failure = await inspectToolImageFailure('/api/tool-media/monsoon/image?preview=1', new AbortController().signal,
      async (_input, init) => { method = init?.method; return response; });
    assert.equal(failure, expected);
    assert.equal(method, 'HEAD');
    assert.equal(response.bodyUsed, false);
  }
});

test('network failures cannot claim that the original file was deleted', async () => {
  const failure = await inspectToolImageFailure('/api/tool-media/monsoon/image', new AbortController().signal,
    async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(failure, 'network');
  assert.notEqual(toolImageFailureKey(failure), toolImageFailureKey('missing'));
});

test('closing an image invalidates even a late missing response', async () => {
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  const pending = inspectToolImageFailure('/api/tool-media/monsoon/image', controller.signal,
    async () => new Promise<Response>(resolve => { finish = resolve; }));
  controller.abort(new DOMException('Image closed', 'AbortError'));
  finish(new Response(null, { status: 404 }));
  await assert.rejects(pending, /Image closed/);
});

test('only explicit missing status selects the bilingual deleted-or-moved explanation', () => {
  const key = toolImageFailureKey('missing');
  assert.equal(resolveMessage('zh-CN', key), '原图可能已删除或移动，请确认文件位置');
  assert.match(resolveMessage('en-US', key), /deleted or moved/);
  for (const failure of ['forbidden', 'authentication', 'network', 'unavailable'] as const) {
    assert.doesNotMatch(resolveMessage('zh-CN', toolImageFailureKey(failure)), /删除|移动/);
    assert.doesNotMatch(resolveMessage('en-US', toolImageFailureKey(failure)), /deleted|moved/);
  }
});
