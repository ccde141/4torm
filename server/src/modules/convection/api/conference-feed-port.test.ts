import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { ConvectionConferenceFeed } from '../application/conference-feed.js';
import { createConvectionModule } from './module.js';
import type { ConvectionSessionService } from '../application/session-service.js';
import type { ConvectionDiscussionService } from '../application/discussion-service.js';
import type { ConvectionCommands } from '../application/round-commands.js';
import type { PreparedConvectionFeed } from './conference-feed-port.js';

const human: CollaborationContext = {
  actor: { type: 'human', id: 'human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['convection']), permissions: new Set(['observe']), requestId: 'feed',
};

test('会议 SSE 订阅与初始快照必须经过中心对流端口', async () => {
  const feed = new ConvectionConferenceFeed();
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] },
    commands: {} as ConvectionCommands,
    sessions: { list: async () => [{ id: 'conv-a', title: '讨论' }],
      require: async () => ({ id: 'conv-a' }) } as ConvectionSessionService,
    discussions: { read: async () => ({ sessionId: 'conv-a', messages: [],
      activeRound: { round: 'public', runId: 'run-a' } }) } as ConvectionDiscussionService,
    feed,
  })]);
  const prepared = await router.prepareTransport('convection', 'conferenceFeed',
    { sessionId: 'conv-a' }, human) as PreparedConvectionFeed;
  const events: string[] = [];
  const stop = prepared.subscribe(event => events.push(event.type));
  const snapshot = await prepared.snapshot();
  feed.publish({ type: 'session-changed', sessionId: 'conv-a' });
  feed.publish({ type: 'round-start', sessionId: 'conv-other', runId: 'run-b',
    round: 'public', message: '不属于当前会议' });
  feed.publish({ type: 'round-start', sessionId: 'conv-a', runId: 'run-a',
    round: 'public', message: '本会议' });
  stop();
  assert.deepEqual(snapshot.sessions.map(room => room.id), ['conv-a']);
  assert.equal(snapshot.live?.activeRound?.runId, 'run-a');
  assert.deepEqual(events, ['session-changed', 'round-start']);
  assert.equal(feed.listenerCount(), 0);
});
