import assert from 'node:assert/strict';
import test from 'node:test';
import { executeBrowserTool } from './browser-tool-adapter.js';

const observation = { scope: 'conversation' as const, ownerId: 'session-a' };

test('refuses a browser call without an owning observation context', async () => {
  await assert.rejects(
    () => executeBrowserTool({ dataDir: 'test', agentId: 'agent-a', args: { action: 'inspect' } }),
    /requires an owning conversation or cyclone context/,
  );
});

test('refuses a browser call from an agent without the browser skill', async () => {
  await assert.rejects(
    () => executeBrowserTool({ dataDir: 'test', agentId: 'agent-a', args: { action: 'inspect' }, observation }, {
      loadAgent: async () => ({ skills: [] }),
    }),
    /Browser Skill is not enabled/,
  );
});

test('forwards a skill-authorized browser action only to its owned runtime', async () => {
  const calls: unknown[] = [];
  const result = await executeBrowserTool({
    dataDir: 'test', agentId: 'agent-a', args: { action: 'click', targetId: 'target-0-1234567890', revision: '3' }, observation,
  }, {
    loadAgent: async () => ({ skills: ['browser'] }),
    runtime: { execute: async input => { calls.push(input); return 'clicked'; } },
  });

  assert.equal(result, 'clicked');
  assert.deepEqual(calls, [{ ...observation, action: 'click', targetId: 'target-0-1234567890', revision: '3', engine: 'system-edge' }]);
});

test('forwards an abort signal to the owned browser runtime', async () => {
  const controller = new AbortController();
  let received: unknown;

  await executeBrowserTool({
    dataDir: 'test', agentId: 'agent-a', args: { action: 'inspect' }, observation, signal: controller.signal,
  }, {
    loadAgent: async () => ({ skills: ['browser'] }),
    runtime: { execute: async input => { received = input.signal; return 'inspected'; } },
  });

  assert.equal(received, controller.signal);
});
