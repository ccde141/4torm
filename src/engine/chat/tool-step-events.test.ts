import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { appendToolStep, finishLatestToolStep } from './tool-step-events.js';

test('Ask 续流把连续工具保留在同一条 assistant 消息中', () => {
  const base: ChatMessage[] = [{
    id: 'after-ask', role: 'assistant', content: '', timestamp: '2026-07-26T00:00:00.000Z',
  }];
  const first = appendToolStep(base, 'after-ask', 'run_command', { command: 'one' });
  const completed = finishLatestToolStep(first, 'after-ask', 'ok', true);
  const second = appendToolStep(completed, 'after-ask', 'read_file', { path: 'two' });

  assert.equal(second.length, 1);
  assert.deepEqual(second[0].toolSteps?.map(step => [step.tool, step.status]), [
    ['run_command', 'done'],
    ['read_file', 'running'],
  ]);
});

test('工具结果元数据随步骤保留', () => {
  const base: ChatMessage[] = [{
    id: 'reply', role: 'assistant', content: '', timestamp: '2026-07-26T00:00:00.000Z',
    toolSteps: [{ tool: 'write_file', args: { path: 'a' }, status: 'running' }],
  }];
  const pendingAutomation = {
    mode: 'created' as const, taskId: 'task-1', name: '巡检', schedule: '0 0 * * *',
    repeatCount: -1, perpetual: true, selfLoop: false, windowN: 2, enabled: false,
    agentName: 'Agent', sandboxLevel: 'project', canWriteFiles: true, promptPreview: '检查',
  };
  const next = finishLatestToolStep(base, 'reply', 'written', true, { before: 'old', pendingAutomation });
  assert.deepEqual(next[0].toolSteps?.[0].diff, { before: 'old' });
  assert.deepEqual(next[0].toolSteps?.[0].pendingAutomation, pendingAutomation);
});
