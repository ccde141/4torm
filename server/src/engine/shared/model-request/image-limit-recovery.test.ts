import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { estimateRequestInput } from '../model-request-usage.js';
import { providerHttpError } from '../provider-request-error.js';
import { applyLearnedImageLimit, retainNewestRequestImages, withImageLimitRecovery } from './image-limit-recovery.js';

const pictures = (count: number) => ({ messages: [{ role: 'user', content: [
  { type: 'text', text: 'Keep this question' },
  ...Array.from({ length: count }, (_, index) => ({ type: 'image_url', image_url: { url: `image-${index}` } })),
] }] });
const rejection = (message: string) => providerHttpError(400, JSON.stringify({ error: { message } }));

test('image recovery removes oldest OpenAI and nested Anthropic pixels without modifying history or tool inputs', () => {
  const body = { messages: [
    ...pictures(2).messages,
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call', input: { type: 'image', source: 'ordinary argument' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content: [
      { type: 'text', text: 'keep metadata' }, { type: 'image', source: { data: 'newest' } },
    ] }] },
  ] };
  const original = structuredClone(body);
  const reduced = retainNewestRequestImages(body, 1);
  assert.deepEqual(body, original);
  assert.equal(reduced.messages.length, body.messages.length);
  assert.match(JSON.stringify(reduced.messages[0]), /Keep this question/);
  assert.doesNotMatch(JSON.stringify(reduced.messages[0]), /image-0|image-1/);
  assert.deepEqual(reduced.messages[1], body.messages[1]);
  assert.deepEqual(reduced.messages[2], body.messages[2]);
});

test('explicit count limits keep the latest pictures and inform subsequent requests and estimates', async () => {
  const key = randomUUID(), body = pictures(5);
  const attempts: number[] = [];
  const result = await withImageLimitRecovery({ key, body, canRetry: () => true, send: async current => {
    const count = estimateRequestInput(current).images;
    attempts.push(count);
    if (count > 3) throw rejection('A maximum of 3 images is allowed');
    assert.match(JSON.stringify(current), /image-4/);
    assert.doesNotMatch(JSON.stringify(current), /image-0|image-1/);
    return 'ok';
  } });
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [5, 3]);
  assert.equal(estimateRequestInput(body).images, 5);
  assert.equal(estimateRequestInput(applyLearnedImageLimit(key, body)).images, 3);
  assert.equal(estimateRequestInput(applyLearnedImageLimit(randomUUID(), body)).images, 5);
});

test('context and size overflow reduce older images before returning a persistent rejection', async () => {
  for (const error of [rejection('maximum context length is 2048 tokens'),
    rejection('image size exceeds maximum allowed size'), providerHttpError(413, 'body too large')]) {
    const key = randomUUID(), body = pictures(4), attempts: number[] = [];
    await assert.rejects(withImageLimitRecovery({ key, body, canRetry: () => true, send: async current => {
      attempts.push(estimateRequestInput(current).images);
      throw error;
    } }), cause => cause === error);
    assert.deepEqual(attempts, [4, 2, 1]);
    assert.equal(estimateRequestInput(applyLearnedImageLimit(key, body)).images, 4);
  }
});

test('small image batches without a numeric limit drop the oldest picture one at a time', async () => {
  const attempts: number[] = [];
  await withImageLimitRecovery({ key: randomUUID(), body: pictures(5), canRetry: () => true, send: async body => {
    const count = estimateRequestInput(body).images;
    attempts.push(count);
    if (count > 3) throw rejection('too many images');
  } });
  assert.deepEqual(attempts, [5, 4, 3]);
});

test('image recovery is bounded, reaches the newest image and never retries after output or cancellation', async () => {
  const attempts: number[] = [];
  await assert.rejects(withImageLimitRecovery({ key: randomUUID(), body: pictures(100), canRetry: () => true,
    send: async current => { attempts.push(estimateRequestInput(current).images); throw rejection('too many images'); },
  }));
  assert.deepEqual(attempts, [100, 50, 25, 12, 1]);
  for (const error of [providerHttpError(401, ''), providerHttpError(500, ''),
    rejection('invalid image data'), rejection('images are not supported'), new Error('socket lost')]) {
    let calls = 0;
    await assert.rejects(withImageLimitRecovery({ key: randomUUID(), body: pictures(3), canRetry: () => true,
      send: async () => { calls++; throw error; } }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(withImageLimitRecovery({ key: randomUUID(), body: pictures(3), canRetry: () => false,
    send: async () => { calls++; throw rejection('too many images'); } }));
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withImageLimitRecovery({ key: randomUUID(), body: pictures(3), signal: controller.signal,
    canRetry: () => true, send: async () => { throw new Error('must not send'); } }), { name: 'AbortError' });
});
