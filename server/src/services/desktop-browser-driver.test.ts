import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopBrowserDriver } from './desktop-browser-driver.js';

const snapshot = { frame: Buffer.from('frame'), title: 'Desktop page', url: 'https://desktop.test', text: 'Desktop content', targets: [] };

test('desktop browser driver keeps every operation bound to the coordinator execution id', async () => {
  const calls: Array<{ action: string; payload: unknown }> = [];
  const driver = new DesktopBrowserDriver({
    request: async (action, payload) => {
      calls.push({ action, payload });
      return action === 'close' ? undefined : snapshot;
    },
    drainEvents: async () => [],
  });

  const opened = await driver.open({ executionId: 'exec-a', engine: 'playwright-chromium', url: 'https://desktop.test' });
  await opened.session.act({ action: 'click', targetId: 'target-2-1234567890' });
  await opened.session.close();

  assert.deepEqual(calls, [
    { action: 'open', payload: { executionId: 'exec-a', url: 'https://desktop.test' } },
    { action: 'inspect', payload: { executionId: 'exec-a' } },
    { action: 'interact', payload: { executionId: 'exec-a', action: 'click', targetId: 'target-2-1234567890' } },
    { action: 'close', payload: { executionId: 'exec-a' } },
  ]);
});

test('desktop browser driver forwards human events from its native surface', async () => {
  const driver = new DesktopBrowserDriver({
    request: async action => action === 'close' ? undefined : snapshot,
    drainEvents: async executionId => [{ source: 'human', type: 'input', detail: executionId }],
  });

  const opened = await driver.open({ executionId: 'exec-a', engine: 'playwright-chromium', url: 'https://desktop.test' });

  assert.deepEqual(await opened.session.drainEvents(), [{ source: 'human', type: 'input', detail: 'exec-a' }]);
});
