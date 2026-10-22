import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionRunner } from '../../../engine/conversation/session-runner.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { TideTask } from '../domain/task.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { runTideTask } from './runner.js';

for (const failAfterTool of [false, true]) {
  test(`潮汐工具混合 JSON 参数在${failAfterTool ? '后续失败' : '成功完成'}时均保存真实状态`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-typed-run-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    const registry = agentRegistryFile(dataDir);
    await fs.mkdir(path.dirname(registry), { recursive: true });
    await fs.writeFile(registry, JSON.stringify({ 'agent-a': {
      id: 'agent-a', name: '测试工位', model: 'test:local',
      config: { tools: ['no-network-test'], toolMode: 'selected' },
    } }));
    const args = { window: 68422, wait: false, bounds: [0, 0, 100, 100],
      options: { target: null, coordinates: { x: 50, y: 40 } } };
    let calls = 0;
    // Replace only the model/executor boundary; task, conversation events and repositories stay real.
    t.mock.method(SessionRunner.prototype, 'chat', async (_prompt, _messages, emit) => {
      calls += 1;
      emit({ type: 'tool-call', tool: 'mcp:desktop:act', args });
      emit({ type: 'tool-result', tool: 'mcp:desktop:act', result: 'ok', ok: true });
      if (failAfterTool) throw new Error('后续模型请求失败');
      return { content: '操作完成', rawContent: '操作完成' };
    });
    const task: TideTask = { id: 'task-a', name: '类型回归', schedule: 'every 5m',
      prompt: '操作窗口', agentId: 'agent-a', repeatCount: -1, pushMode: 'accumulate',
      windowN: 2, selfLoop: false, consecutiveErrors: 2, enabled: true,
      createdAt: new Date().toISOString() };
    const tasks = new FileTideTaskRepository(dataDir);
    const runs = new FileTideRunRepository(dataDir);
    await tasks.upsert(task);

    const result = await runTideTask({ dataDir, tasks, runs }, task, false, 'typed-run');
    assert.equal(calls, 1);
    assert.equal(result.status, failAfterTool ? 'error' : 'success');
    assert.equal(result.agentId, task.agentId);
    assert.equal(result.sessionState, failAfterTool ? undefined : 'retained');
    assert.deepEqual(result.toolCalls[0]?.args, args);
    const stored = await runs.get(task.id, 'typed-run');
    assert.equal(stored?.status, result.status);
    assert.equal(stored?.agentId, task.agentId);
    assert.equal(stored?.sessionState, result.sessionState);
    assert.deepEqual(stored?.toolCalls[0]?.args, args);
    const fresh = await tasks.get(task.id);
    assert.equal(fresh?.consecutiveErrors, failAfterTool ? 3 : 0);
    assert.equal(fresh?.enabled, !failAfterTool);
    if (failAfterTool) assert.match(result.error ?? '', /后续模型请求失败/);
    else assert.equal(result.answer, '操作完成');
  });
}
