import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedActivityEvent, MAX_ACTIVITY_EVENT_CHARS } from './bounded-activity-event.js';

test('大段工具输出的临时事件截短后仍保留有效截图引用', () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const event = { type: 'tool-result', tool: 'capture', result: 'X'.repeat(30_000), toolImages };
  const bounded = boundedActivityEvent(event);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(bounded.event.toolImages, toolImages);
  assert.ok(JSON.stringify(bounded.event).length <= MAX_ACTIVITY_EVENT_CHARS);
  assert.equal(event.result.length, 30_000);
});
