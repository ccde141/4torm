import assert from 'node:assert/strict';
import test from 'node:test';
import { toolImageUrl, type ToolMediaScope } from './tool-media';

test('tool images address their owning conversation or archived run on the configured backend', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __FOURTORM_CONNECTION__: { origin: 'https://backend.example:3001' },
  } });
  try {
    const scopes: ToolMediaScope[] = [
      { feature: 'monsoon', agentId: 'agent&a', sessionId: 'session b' },
      { feature: 'cyclone', workshopId: 'workshop', kind: 'seat', targetId: 'seat' },
      { feature: 'tradewind', workflowId: 'workflow', executionId: 'execution', nodeId: 'node', kind: 'meeting', round: '2' },
      { feature: 'tide', taskId: 'task', runId: 'run' },
      { feature: 'tide', agentId: 'agent', sessionId: 'session' },
      { feature: 'convection', sessionId: 'meeting' },
    ];
    for (const scope of scopes) {
      const url = new URL(toolImageUrl(scope, 'image/id'));
      assert.equal(url.origin, 'https://backend.example:3001');
      assert.equal(url.pathname, `/api/tool-media/${scope.feature}/image%2Fid`);
      for (const [key, value] of Object.entries(scope)) {
        if (key !== 'feature') assert.equal(url.searchParams.get(key), value);
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
