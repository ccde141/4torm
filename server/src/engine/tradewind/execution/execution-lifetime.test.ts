import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForTaskFailureOrAbort } from './execution-lifetime.js';

test('后台信封处理失败会立即结束节点执行', async () => {
  const controller = new AbortController();
  await assert.rejects(
    waitForTaskFailureOrAbort(Promise.reject(new Error('model failed')), controller.signal),
    /model failed/,
  );
});

test('后台信封处理正常待命时由工作流中止收口', async () => {
  const controller = new AbortController();
  const waiting = waitForTaskFailureOrAbort(Promise.resolve(), controller.signal);
  controller.abort();
  await waiting;
  assert.equal(controller.signal.aborted, true);
});
