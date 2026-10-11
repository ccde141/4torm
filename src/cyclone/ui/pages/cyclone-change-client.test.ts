import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeCycloneChanges } from './cyclone-change-client.js';

test('all room and workshop consumers share one change stream and reconcile on connection', () => {
  const previous = globalThis.EventSource;
  const sources: FakeSource[] = [];
  globalThis.EventSource = class extends FakeSource {
    constructor(url: string) { super(url); sources.push(this); }
  } as typeof EventSource;
  try {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = subscribeCycloneChanges(event => first.push(event.type));
    const offSecond = subscribeCycloneChanges(event => second.push(event.type));
    assert.equal(sources.length, 1);
    sources[0].onopen?.(new Event('open'));
    sources[0].onmessage?.({ data: JSON.stringify({ type: 'change', workshopId: 'w', scope: 'room', id: 'r', revision: 1 }) } as MessageEvent);
    assert.deepEqual(first, ['sync', 'change']);
    assert.deepEqual(second, ['sync', 'change']);
    offFirst();
    assert.equal(sources[0].closed, false);
    offSecond();
    assert.equal(sources[0].closed, true);
  } finally { globalThis.EventSource = previous; }
});

class FakeSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() { this.closed = true; }
}
