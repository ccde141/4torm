import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDispatchReadReceipts, readDispatchError } from './useWorkshopDispatches.js';
import type { CycloneDispatch } from './dispatch-timeline.js';

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

test('工位已读回执只替换服务端确认的派发并保留新快照项', () => {
  const base = { workshopId: 'w', sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'a',
    sourceSeatTitle: 'A', sourceTurnId: 't', sourceRoundSeq: 0, dispatchOrder: 0,
    targetSeatId: 'b', targetSeatTitle: 'B', task: 'work', status: 'completed',
    readState: 'unread', decisionState: 'not_applicable', createdAt: '', updatedAt: '' } as const;
  const first: CycloneDispatch = { ...base, id: 'first' };
  const newer: CycloneDispatch = { ...base, id: 'newer' };

  const merged = mergeDispatchReadReceipts([first, newer], [{ ...first, readState: 'read' }]);

  assert.equal(merged[0].readState, 'read');
  assert.equal(merged[1], newer);
});
