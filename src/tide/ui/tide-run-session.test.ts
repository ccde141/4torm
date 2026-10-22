import assert from 'node:assert/strict';
import test from 'node:test';
import type { TideRunRecord } from '../../api/tide.js';
import { tideRunSessionTarget } from './tide-run-session.js';

const run: TideRunRecord = {
  taskId: 'task-a', timestamp: '2026-10-21T00:00:00.000Z', status: 'success',
  agentId: 'original-agent', sessionId: 'original-session', sessionState: 'retained',
  answer: 'done', rawContent: 'done', toolCalls: [], turns: 1, durationMs: 10,
};

test('历史会话使用运行时的 Agent 与会话身份，不随任务换绑而跳转到新 Agent', () => {
  assert.deepEqual(tideRunSessionTarget(run, 'replacement-agent'), {
    agentId: 'original-agent', sessionId: 'original-session',
  });
  assert.deepEqual(tideRunSessionTarget({ ...run, agentId: undefined }, 'legacy-agent'), {
    agentId: 'legacy-agent', sessionId: 'original-session',
  });
});

test('明确归档的运行与空会话不生成跳转，未知旧记录保留查询能力', () => {
  assert.equal(tideRunSessionTarget({ ...run, sessionState: 'archived' }, 'other'), null);
  assert.equal(tideRunSessionTarget({ ...run, sessionId: '' }, 'other'), null);
  assert.ok(tideRunSessionTarget({ ...run, sessionState: undefined }, 'other'));
});
