import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../../types';
import { createAgentDeletionFlow } from './agent-deletion';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('删除立即进入待处理状态，成功后屏蔽滞后的列表并拒绝重复提交', async () => {
  const operation = deferred();
  const events: string[] = [];
  let calls = 0;
  const flow = createAgentDeletionFlow(async () => {
    calls++;
    return operation.promise;
  }, {
    onPendingChange: ids => events.push(`pending:${[...ids].join(',')}`),
    onDeleted: id => events.push(`deleted:${id}`),
    onError: error => events.push(`error:${error.message}`),
  });
  const agents = [{ id: 'agent-a' }] as Agent[];

  const deleting = flow.remove('agent-a');
  await flow.remove('agent-a');
  assert.equal(calls, 1);
  assert.deepEqual(events, ['pending:agent-a']);
  assert.deepEqual(flow.visibleAgents(agents), agents);

  operation.resolve();
  await deleting;
  assert.deepEqual(events, ['pending:agent-a', 'deleted:agent-a', 'pending:']);
  assert.deepEqual(flow.visibleAgents(agents), []);
  assert.deepEqual(flow.visibleAgents([]), []);
});

test('删除失败保留卡片、报告真实错误并允许重试', async () => {
  let calls = 0;
  const errors: string[] = [];
  const flow = createAgentDeletionFlow(async () => {
    calls++;
    if (calls === 1) throw new Error('磁盘拒绝');
  }, {
    onPendingChange: () => {},
    onDeleted: () => {},
    onError: error => errors.push(error.message),
  });
  const agents = [{ id: 'agent-a' }] as Agent[];

  await flow.remove('agent-a');
  assert.deepEqual(errors, ['磁盘拒绝']);
  assert.deepEqual(flow.visibleAgents(agents), agents);
  await flow.remove('agent-a');
  assert.equal(calls, 2);
  assert.deepEqual(flow.visibleAgents(agents), []);
});
