import assert from 'node:assert/strict';
import test from 'node:test';
import { CycloneChangeFeed } from './change-feed.js';

test('变更信号只含定位字段、版本递增且订阅可释放', () => {
  const feed = new CycloneChangeFeed();
  const received: unknown[] = [];
  const stop = feed.subscribe(event => received.push(event));
  feed.publish('cyc-a', 'room', 'room-a');
  feed.publish('cyc-b', 'bulletin', 'cyc-b');
  assert.deepEqual(received, [
    { type: 'change', workshopId: 'cyc-a', scope: 'room', id: 'room-a', revision: 1 },
    { type: 'change', workshopId: 'cyc-b', scope: 'bulletin', id: 'cyc-b', revision: 2 },
  ]);
  stop();
  feed.publish('cyc-a', 'room', 'room-a');
  assert.equal(received.length, 2);
  assert.equal(feed.listenerCount, 0);
});

test('失效订阅者不影响持久化写入方与其他连接', () => {
  const feed = new CycloneChangeFeed();
  const received: number[] = [];
  feed.subscribe(() => { throw new Error('连接断开'); });
  feed.subscribe(event => received.push(event.revision));
  assert.doesNotThrow(() => feed.publish('cyc-a', 'workshop', 'cyc-a'));
  assert.deepEqual(received, [1]);
  assert.equal(feed.listenerCount, 1);
});
