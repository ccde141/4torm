import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvectionConferenceFeed } from './conference-feed.js';

test('会议事件向多个观察者广播，退订后不再接收', () => {
  const feed = new ConvectionConferenceFeed();
  const first: string[] = [];
  const second: string[] = [];
  const stopFirst = feed.subscribe(event => first.push(event.type));
  const stopSecond = feed.subscribe(event => second.push(event.type));
  feed.publish({ type: 'session-changed', sessionId: 'conv-a' });
  stopFirst();
  feed.publish({ type: 'round-start', sessionId: 'conv-a', runId: 'run-a',
    round: 'public', message: '开始' });
  stopSecond();
  assert.deepEqual(first, ['session-changed']);
  assert.deepEqual(second, ['session-changed', 'round-start']);
  assert.equal(feed.listenerCount(), 0);
});

test('一个断开的观察者不能中断会议执行或其他观察者', () => {
  const feed = new ConvectionConferenceFeed();
  const events: string[] = [];
  feed.subscribe(() => { throw new Error('closed connection'); });
  feed.subscribe(event => events.push(event.type));
  feed.publish({ type: 'session-changed', sessionId: 'conv-a' });
  assert.deepEqual(events, ['session-changed']);
});
