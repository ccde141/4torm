import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolProgressTracker } from './tool-progress.js';

test('tool progress emits immediately, throttles chunks, and keeps per-tool totals', () => {
  let now = 1_000;
  const events: Array<{ tool?: string; argumentChars: number; elapsed: number }> = [];
  const tracker = createToolProgressTracker({
    startedAt: now,
    now: () => now,
    minIntervalMs: 250,
    restoreName: name => name === 'write_file_1' ? 'write_file' : name,
    onProgress: event => events.push(event),
  });

  tracker.push([{ index: 0, function: { name: 'write_file_1', arguments: '{"path":"a.ts",' } }]);
  now += 100;
  tracker.push([{ index: 0, function: { arguments: '"content":"one"' } }]);
  now += 150;
  tracker.push([{ index: 0, function: { arguments: '}' } }]);

  assert.deepEqual(events, [
    { stage: 'preparing', tool: 'write_file', argumentChars: 15, elapsed: 0 },
    { stage: 'preparing', tool: 'write_file', argumentChars: 31, elapsed: 250 },
  ]);
});

test('tool progress emits when a delayed tool name becomes available', () => {
  let now = 2_000;
  const events: Array<{ tool?: string; argumentChars: number; elapsed: number }> = [];
  const tracker = createToolProgressTracker({
    startedAt: now,
    now: () => now,
    minIntervalMs: 250,
    onProgress: event => events.push(event),
  });

  tracker.push([{ index: 0, function: { arguments: '{"path":' } }]);
  now += 10;
  tracker.push([{ index: 0, function: { name: 'edit_file' } }]);

  assert.deepEqual(events, [
    { stage: 'preparing', tool: undefined, argumentChars: 8, elapsed: 0 },
    { stage: 'preparing', tool: 'edit_file', argumentChars: 8, elapsed: 10 },
  ]);
});
