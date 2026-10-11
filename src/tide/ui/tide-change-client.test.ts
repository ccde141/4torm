import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeTideChanges } from './tide-change-client.js';

test('潮汐页面订阅即时变更、重连同步和失联信号，卸载关闭连接', () => {
  const previous = globalThis.EventSource;
  class FakeSource {
    static last: FakeSource;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    closed = false;
    constructor(readonly url: string) { FakeSource.last = this; }
    close() { this.closed = true; }
  }
  globalThis.EventSource = FakeSource as unknown as typeof EventSource;
  try {
    const events: unknown[] = [];
    const stop = subscribeTideChanges(event => events.push(event));
    const source = FakeSource.last!;
    assert.equal(source.url, '/api/tide/changes');
    source.onopen?.();
    source.onmessage?.({ data: JSON.stringify({ type: 'change', scope: 'run',
      taskId: 'task-a', runId: 'run-a', agentId: 'worker', revision: 1 }) });
    source.onmessage?.({ data: JSON.stringify({ type: 'change', scope: 'run',
      taskId: 'task-a', revision: 2 }) });
    source.onerror?.();
    assert.deepEqual(events, [
      { type: 'sync' },
      { type: 'change', scope: 'run', taskId: 'task-a', runId: 'run-a',
        agentId: 'worker', revision: 1 },
      { type: 'disconnected' },
    ]);
    stop();
    assert.equal(source.closed, true);
  } finally {
    globalThis.EventSource = previous;
  }
});
