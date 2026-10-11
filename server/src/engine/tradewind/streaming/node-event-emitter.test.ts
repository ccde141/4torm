import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeEventEmitter } from './node-event-emitter.js';
import { subscribeUnified } from './unified-stream.js';

test('轮次回放无损合并相邻文本事件但实时事件仍逐条送达', () => {
  const emitter = new NodeEventEmitter('node-a');
  const live: Array<{ type: string; seq?: number }> = [];
  emitter.addListener(event => { live.push(event); });
  emitter.emit({ type: 'token', content: '甲' });
  emitter.emit({ type: 'token', content: '乙' });
  emitter.emit({ type: 'reasoning', content: '思' });
  emitter.emit({ type: 'reasoning', content: '考' });
  emitter.emit({ type: 'delegate-token', delegateId: 'a', content: '子' });
  emitter.emit({ type: 'delegate-token', delegateId: 'a', content: '一' });
  emitter.emit({ type: 'delegate-token', delegateId: 'b', content: '子二' });
  emitter.emit({ type: 'tool-call', tool: 'read', args: {} });
  emitter.emit({ type: 'token', content: '丙' });
  assert.deepEqual(live.map(event => event.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(emitter.getRoundLog(), [
    { type: 'token', content: '甲乙', seq: 2 },
    { type: 'reasoning', content: '思考', seq: 4 },
    { type: 'delegate-token', delegateId: 'a', content: '子一', seq: 6 },
    { type: 'delegate-token', delegateId: 'b', content: '子二', seq: 7 },
    { type: 'tool-call', tool: 'read', args: {}, seq: 8 },
    { type: 'token', content: '丙', seq: 9 },
  ]);
  const replayed: Array<{ type: string; seq?: number }> = [];
  emitter.addListener(event => { replayed.push(event); });
  assert.deepEqual(replayed.map(event => event.seq), [2, 4, 6, 7, 8, 9]);
  assert.equal(emitter.lastSeq, 9);
});

test('节点统一流事件带原始工作流与执行身份', () => {
  const events: Array<Record<string, unknown>> = [];
  const unsubscribe = subscribeUnified(event => { if (event.nodeId === 'identity-node') events.push(event); });
  try {
    const emitter = new NodeEventEmitter('identity-node', {
      workflowId: 'wf-old', executionId: 'exec-old',
    });
    emitter.emit({ type: 'token', content: '甲' });
    assert.deepEqual(events, [{ type: 'token', content: '甲', seq: 1,
      scope: 'agent', nodeId: 'identity-node', workflowId: 'wf-old', executionId: 'exec-old' }]);
  } finally { unsubscribe(); }
});
