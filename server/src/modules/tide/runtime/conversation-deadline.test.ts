import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { SessionRunner, type SessionRunnerOpts } from '../../../engine/conversation/session-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { TideTask } from '../domain/task.js';
import { writeTideSession } from '../sessions/session-store.js';
import { TideContextCompaction } from './context-compaction.js';
import { executeTideConversation, TideConversationFailure } from './tide-conversation.js';

const MINUTE = 60_000;

for (const outcome of ['success', 'failure', 'abort'] as const) {
  test(`真实潮汐运行的长压缩${outcome}不受执行时长限制，且通知失败不改变结果`, async t => {
    const fixture = await conversationFixture(t);
    const advance = fakeClock(t);
    const controller = new AbortController();
    let aborts = 0;
    const transform = TideContextCompaction.prototype.transform;
    t.mock.method(TideContextCompaction.prototype, 'transform', function(this: TideContextCompaction, llm) {
      Object.assign(Reflect.get(this, 'summaryPorts'), {
        resolveSummaryBudget: async () => 100_000,
        summarize: async () => {
          advance(61 * MINUTE);
          assert.equal(aborts, 0, '压缩期间不能耗尽普通工作预算');
          if (outcome === 'abort') {
            controller.abort(new Error('主动停止潮汐任务'));
            throw controller.signal.reason;
          }
          if (outcome === 'failure') throw new Error('摘要生成失败');
          return '保留旧事实，继续当前任务';
        },
      });
      return transform.call(this, llm);
    });
    t.mock.method(SessionRunner.prototype, 'abort', () => { aborts++; });
    t.mock.method(SessionRunner.prototype, 'chat', async function(this: SessionRunner, _prompt, messages) {
      const options = Reflect.get(this, 'opts') as SessionRunnerOpts;
      advance(2 * MINUTE);
      const caller = options.llmTransform!({ call: async () => ({ content: '完成', finishReason: 'stop' }) });
      await caller.prepare?.(messages, {}, controller.signal, []);
      if (outcome === 'success') {
        advance(80 * MINUTE);
        assert.equal(aborts, 0, '长任务不受固定执行时限影响');
      }
      return { content: '完成', rawContent: '完成' };
    });
    const run = executeTideConversation(fixture.dataDir, fixture.task, undefined, undefined,
      async () => { throw new Error('进度接收端断开'); }, undefined, controller.signal);
    if (outcome === 'success') assert.equal((await run).answer, '完成');
    else await assert.rejects(run, error => error instanceof TideConversationFailure
      && error.aborted === (outcome === 'abort'));
    advance(180 * MINUTE);
    assert.equal(aborts, 0, '没有残留的执行计时器');
  });
}

function fakeClock(t: TestContext): (milliseconds: number) => void {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  return milliseconds => { now += milliseconds; t.mock.timers.tick(milliseconds); };
}

async function conversationFixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-conversation-deadline-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ worker: { id: 'worker', name: 'Worker', model: 'test:model',
    config: { toolMode: 'selected', tools: [] } } }));
  const task: TideTask = { id: 'deadline-task', name: '定时巡检', schedule: 'every 5m',
    prompt: '继续工作', agentId: 'worker', pushMode: 'accumulate', targetSessionId: 'session-a',
    windowN: 6, repeatCount: -1, selfLoop: false, consecutiveErrors: 0,
    enabled: true, createdAt: new Date().toISOString() };
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, tide: 1000 } });
  await writeTideSession(dataDir, { id: 'session-a', agentId: 'worker', agentName: 'Worker', title: '巡检',
    model: 'test:model', systemPrompt: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [
      { id: 'u1', role: 'user', content: '此前的任务内容 '.repeat(1000), timestamp: new Date().toISOString() },
      { id: 'a1', role: 'assistant', content: '此前已核验的结果 '.repeat(1000), timestamp: new Date().toISOString() },
    ] }, task.id, task.name);
  return { dataDir, task };
}
