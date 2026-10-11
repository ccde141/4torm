import assert from 'node:assert/strict';
import test from 'node:test';
import { TideChangeFeed } from './change-feed.js';

test('潮汐变更流只发身份和递增版本，退订后停止通知', () => {
  const feed = new TideChangeFeed();
  const events: unknown[] = [];
  const stop = feed.subscribe(event => events.push(event));
  feed.publish({ scope: 'task', taskId: 'task-a', agentId: 'agent-a' });
  feed.publish({ scope: 'run', taskId: 'task-a', runId: 'run-a', agentId: 'agent-a' });
  stop();
  feed.publish({ scope: 'record', taskId: 'task-a', runId: 'run-a' });
  assert.deepEqual(events, [
    { type: 'change', scope: 'task', taskId: 'task-a', agentId: 'agent-a', revision: 1 },
    { type: 'change', scope: 'run', taskId: 'task-a', runId: 'run-a', agentId: 'agent-a', revision: 2 },
  ]);
  assert.equal(feed.listenerCount, 0);
});
