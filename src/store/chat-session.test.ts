import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../types';
import { buildSession } from './chat';

const agent = {
  id: 'agent-123', name: '测试 Agent', role: '', status: 'idle',
  model: '', description: '', createdAt: '', updatedAt: '', tasksCompleted: 0,
} as Agent;

test('新会话使用选中 Agent 的真实 ID', () => {
  const session = buildSession(agent);
  assert.equal(session.agentId, agent.id);
  assert.match(session.id, /^agent-123-/);
});

test('浏览器点击事件不能被当成 Agent 创建幽灵会话', () => {
  assert.throws(() => buildSession({ type: 'click' } as unknown as Agent), /Agent ID 无效/);
});
