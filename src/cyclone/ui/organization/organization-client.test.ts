import assert from 'node:assert/strict';
import test from 'node:test';
import { saveOrganization } from './organization-client.js';

test('协作结构保存只通过中心调用并保留期望版本', async () => {
  const originalFetch = globalThis.fetch;
  let call: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    call = JSON.parse(String(init?.body));
    return Response.json({ version: 2, revision: 4, updatedAt: '2026-10-01T00:00:00.000Z',
      groups: [], externalRelations: [], seatPositions: {} });
  };
  try {
    await saveOrganization('workshop-1', {
      baseRevision: 3, activatesExplicitMode: false,
      groups: [], externalRelations: [], seatPositions: {},
    });
    assert.deepEqual(call, {
      feature: 'cyclone', method: 'saveWorkshopOrganization', input: {
        workshopId: 'workshop-1', expectedRevision: 3,
        groups: [], externalRelations: [], seatPositions: {},
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
