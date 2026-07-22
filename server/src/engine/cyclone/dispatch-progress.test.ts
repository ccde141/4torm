import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceDispatchActivity } from './dispatch-progress.js';

test('派发进度只记录阶段和工具，不保存模型正文或工具参数', () => {
  let activity = reduceDispatchActivity(undefined, { type: 'queue-wait' });
  assert.deepEqual(activity, { phase: 'waiting-agent' });
  activity = reduceDispatchActivity(activity, { type: 'tool-call', tool: 'write_file', args: { content: 'secret' } });
  assert.deepEqual(activity, { phase: 'tool-exec', tool: 'write_file' });
  activity = reduceDispatchActivity(activity, { type: 'heartbeat', phase: 'tool-exec', elapsed: 4200 });
  assert.deepEqual(activity, { phase: 'tool-exec', tool: 'write_file', elapsedSeconds: 4 });
});

test('模型输出和工具参数准备有明确的可观察状态', () => {
  assert.deepEqual(reduceDispatchActivity(undefined, { type: 'token', content: '正文' }), {
    phase: 'model-output',
  });
  assert.deepEqual(reduceDispatchActivity(undefined, {
    type: 'tool-progress', stage: 'preparing', tool: 'write_file', argumentChars: 900, elapsed: 3100,
  }), { phase: 'tool-preparing', tool: 'write_file', elapsedSeconds: 3, argumentChars: 900 });
});

test('工具返回后状态回到等待模型，委托也显示为正在执行的工具', () => {
  assert.deepEqual(reduceDispatchActivity(
    { phase: 'tool-exec', tool: 'write_file' },
    { type: 'tool-result', tool: 'write_file', result: 'ok', ok: true },
  ), { phase: 'llm-waiting' });
  assert.deepEqual(reduceDispatchActivity(undefined, {
    type: 'delegate-start', task: '检查代码', delegateId: 'delegate-a',
  }), { phase: 'tool-exec', tool: 'delegate', target: '检查代码' });
});
