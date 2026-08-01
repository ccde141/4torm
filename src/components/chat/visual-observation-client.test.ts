import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isActiveObservationStatus,
  observationOwnerQuery,
  readVisualObservation,
  setVisualObservationControl,
  visualObservationFrameUrl,
} from './visual-observation-client';

const owner = { scope: 'cyclone' as const, ownerId: 'room:seat one' };

test('visual observation URLs preserve owner identity and encode observation ids', () => {
  assert.equal(observationOwnerQuery(owner), 'scope=cyclone&ownerId=room%3Aseat+one');
  assert.equal(
    visualObservationFrameUrl('surface/one', owner, 7),
    '/api/tools/observations/surface%2Fone/frame?scope=cyclone&ownerId=room%3Aseat+one&v=7',
  );
});

test('visual observation client reads details and transfers control through one contract', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') return new Response(null, { status: 204 });
    return Response.json({ item: { id: 'surface', command: 'Browse', startedAt: 1, status: 'running' } });
  };

  const item = await readVisualObservation('surface', owner, undefined, fetcher);
  await setVisualObservationControl('surface', owner, 'human', undefined, fetcher);

  assert.equal(item.id, 'surface');
  assert.equal(calls[1]?.init?.body, JSON.stringify({ control: 'human' }));
  assert.equal(calls[1]?.init?.method, 'POST');
});

test('active observation status is explicit and excludes terminal states', () => {
  assert.equal(isActiveObservationStatus('running'), true);
  assert.equal(isActiveObservationStatus('waiting'), true);
  assert.equal(isActiveObservationStatus('cancelling'), true);
  assert.equal(isActiveObservationStatus('completed'), false);
  assert.equal(isActiveObservationStatus('failed'), false);
});
