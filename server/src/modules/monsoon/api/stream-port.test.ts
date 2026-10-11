import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createMonsoonModule } from './module.js';

const human: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['monsoon']), permissions: new Set(['execute']),
  requestId: 'request-a',
};

test('季风 chat / reply 在固定公开口登记，并经中心校验后准备轮次', async () => {
  const calls: unknown[] = [];
  const source = { snapshot: () => ({ revision: 'none', items: [] }),
    findRun: () => undefined, subscribeRun: () => () => undefined,
    abort: async () => false };
  const turns = {
    start: async (input: unknown) => { calls.push(['chat', input]); return { runId: 'run-a' }; },
    resume: async (...input: unknown[]) => { calls.push(['reply', input]); return { runId: 'run-b' }; },
  };
  const module = createMonsoonModule(source, { summary: async () => ({}) } as never,
    undefined, undefined, turns as never);
  const router = new CollaborationRouter([module]);
  const chat = { agentId: 'agent-a', sessionId: 'session-a', inputRunId: 'run-a', messages: [] };
  assert.deepEqual(await router.prepareTransport('monsoon', 'chat', chat, human), { runId: 'run-a' });
  assert.deepEqual(await router.prepareTransport('monsoon', 'reply', {
    sessionId: 'session-a', inputRunId: 'run-c', expectedWaitingRunId: 'run-a', answer: '选项一',
  }, human), { runId: 'run-b' });
  assert.deepEqual(calls, [
    ['chat', chat], ['reply', ['session-a', 'run-c', '选项一', 'run-a']],
  ]);
  await assert.rejects(router.prepareTransport('monsoon', 'chat', {
    ...chat, inputRunId: '%bad',
  }, human), error => error instanceof FrameworkError && error.data.code === 'INPUT_INVALID');
  await assert.rejects(router.prepareTransport('monsoon', 'reply', {
    sessionId: 'session-a', inputRunId: 'run-b', expectedWaitingRunId: 'run-a',
  }, human), error => error instanceof FrameworkError && error.data.code === 'FEATURE_INPUT_INVALID');
  await assert.rejects(router.prepareTransport('monsoon', 'reply', {
    sessionId: 'session-a', inputRunId: 'run-b', answer: '继续',
  }, human), error => error instanceof FrameworkError && error.data.code === 'FEATURE_INPUT_INVALID');
  await assert.rejects(router.prepareTransport('monsoon', 'reply', {
    sessionId: 'session-a', inputRunId: 'run-b', expectedWaitingRunId: '%bad', answer: '继续',
  }, human), error => error instanceof FrameworkError && error.data.code === 'INPUT_INVALID');
});
