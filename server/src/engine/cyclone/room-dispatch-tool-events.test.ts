import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeToolCallResult } from '../shared/react/native-loop.js';
import { createDispatchStartBuffer } from './dispatch-start-buffer.js';
import { createRoomMessageSegments } from './room-message-segments.js';
import { makeRoomToolCaller, type RoomEvent } from './room-runner.js';
import { addSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';

test('room dispatch records one completed tool event and its dispatch segment', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-dispatch-events-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '工位' });
  const events: RoomEvent[] = [];
  const segments = createRoomMessageSegments();
  const caller = makeRoomToolCaller({
    dataDir, workshopId: workshop.id, seatId: seat.id, seatTitle: seat.title,
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', speaker: seat.title,
    signal: undefined, roomId: 'room', turnId: 'turn', roundSeq: 1, contextVersion: 0,
    dispatchStarts: createDispatchStartBuffer(() => {}),
    onEvent(event) {
      events.push(event);
      if (event.type === 'tool-call') segments.toolCall(event.tool, event.args);
      if (event.type === 'tool-result') segments.toolResult(event.result, event.ok);
      if (event.type === 'dispatch-created') segments.dispatch(event.dispatch.id);
    },
  });

  const outcome = normalizeToolCallResult(await caller.call('dispatch', {
    target: seat.title, task: '整理方案',
  }));
  assert.equal(outcome.ok, true);
  assert.deepEqual(events.map(event => event.type), [
    'tool-call', 'dispatch-created', 'tool-result',
  ]);
  assert.deepEqual(segments.segments.map(segment => segment.kind), ['tools', 'dispatch']);
  assert.equal(segments.segments[0].kind === 'tools'
    && segments.segments[0].tools[0].status, 'success');
});

test('room dispatch validation failure reports failed tool status', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-dispatch-error-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: RoomEvent[] = [];
  const caller = makeRoomToolCaller({
    dataDir, workshopId: 'workshop', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', speaker: '工位',
    signal: undefined, roomId: 'room', turnId: 'turn', roundSeq: 1, contextVersion: 0,
    dispatchStarts: createDispatchStartBuffer(() => {}), onEvent: event => events.push(event),
  });

  const outcome = normalizeToolCallResult(await caller.call('dispatch', { target: '', task: '' }));
  assert.equal(outcome.ok, false);
  assert.deepEqual(events.map(event => event.type), ['tool-call', 'tool-result']);
  assert.equal(events[1].type === 'tool-result' && events[1].ok, false);
});
