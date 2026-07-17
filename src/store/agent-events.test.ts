import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTS_CHANGED_EVENT, notifyAgentsChanged } from './agent-events';

test('通知 Agent 变更事件', () => {
  const events: string[] = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => { events.push(event.type); } },
  });

  notifyAgentsChanged();

  assert.deepEqual(events, [AGENTS_CHANGED_EVENT]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
});
