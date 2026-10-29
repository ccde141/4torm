import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSkippedInputNotice, humanInputStatus, pendingUserRecovery, summarizeSkippedInputNotice,
  unrepresentedHumanInputs } from './human-input-presentation';
import type { PendingInput } from '../../engine/chat/input-outbox';
import type { ChatMessage } from '../../types';

const skipped = [
  'read_file: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  'read_file: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  'load_skill: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
];

test('skipped steering work lists unique names once and shares one localized reason', () => {
  assert.equal(
    formatSkippedInputNotice(skipped, 'zh-CN'),
    '已跳过的工具：read_file；load_skill（因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  );
  assert.equal(
    formatSkippedInputNotice(skipped, 'en-US'),
    'Skipped tools: read_file; load_skill (Cancelled by human steering; not executed. Reconsider the next action based on the new request.)',
  );
});

const pending: PendingInput = { input: { agentId: 'agent', sessionId: 'session', runId: 'run',
  id: 'input', content: 'A correction' }, state: 'received' };
const receipt: ChatMessage = { id: 'answer', role: 'assistant', content: 'Working', timestamp: 'now',
  humanInputs: [{ id: 'input', runId: 'run', content: 'A correction', receivedAt: 'now', sequence: 1, state: 'included' }] };

test('the durable steering bubble owns received and restored outbox entries without modifying either', () => {
  const retained: PendingInput = { ...pending, state: 'retained', error: 'Old connection error' };
  const before = structuredClone({ receipt, pending, retained });
  assert.deepEqual(unrepresentedHumanInputs([receipt], [pending, retained]), []);
  assert.equal(unrepresentedHumanInputs([receipt], [{ ...pending, input: { ...pending.input, runId: 'other' } }]).length, 1);
  assert.deepEqual({ receipt, pending, retained }, before);
});

test('an unacknowledged input stays visible while continued inputs are not rendered twice', () => {
  assert.deepEqual(unrepresentedHumanInputs([], [pending]), [pending]);
  const user: ChatMessage = { id: pending.input.id, role: 'user', content: pending.input.content, timestamp: 'now' };
  assert.deepEqual(unrepresentedHumanInputs([user], [pending]), []);
  const retained: PendingInput = { ...pending, state: 'retained' };
  assert.equal(pendingUserRecovery(user, [retained], [user]), retained, 'a saved message may still need its execution started');
  assert.equal(pendingUserRecovery(user, [retained], [user, { ...receipt, inputRunId: 'followup-input' }]), undefined);
  assert.equal(pendingUserRecovery(user, [pending], [user]), undefined);
});

test('empty skipped work does not create a notice', () => {
  assert.equal(formatSkippedInputNotice([], 'zh-CN'), '');
});

test('received input explains the current run wait without claiming it has been included', () => {
  for (const phase of ['llm-waiting', 'model-output', 'tool-preparing'] as const) {
    assert.equal(humanInputStatus('received', 'run', 'zh-CN', { runId: 'run', phase }), '已接收 · 等待本次模型响应');
  }
  assert.equal(humanInputStatus('received', 'run', 'zh-CN', { runId: 'run', phase: 'tool-exec' }), '已接收 · 等待当前工具结束');
  assert.equal(humanInputStatus('received', 'run', 'zh-CN', { runId: 'run', phase: 'team-waiting' }), '已接收 · 等待主 Agent 继续');
  assert.equal(humanInputStatus('received', 'run', 'zh-CN', { runId: 'run', phase: 'tool-exec', compacting: true }), '已接收 · 等待压缩结束');
  assert.equal(humanInputStatus('received', 'run', 'zh-CN', { runId: 'run', phase: 'tool-exec', closed: true }), '已接收 · 等待本轮结束');
  assert.equal(humanInputStatus('sending', 'run', 'zh-CN', { runId: 'run', ready: false }), '待发送 · 等待执行就绪');
});

test('terminal receipts and other runs do not inherit a running task wait', () => {
  const activity = { runId: 'run', phase: 'tool-exec' as const, compacting: true, ready: false };
  assert.equal(humanInputStatus('included', 'run', 'zh-CN', activity), '已纳入上下文');
  assert.equal(humanInputStatus('retained', 'run', 'zh-CN', activity), '已保留 · 未消费');
  assert.equal(humanInputStatus('queued', 'run', 'zh-CN', activity), '等待下一轮');
  assert.equal(humanInputStatus('received', 'old-run', 'zh-CN', activity), '已接收 · 等待处理');
  assert.equal(humanInputStatus('received', 'run', 'zh-CN'), '已接收 · 等待处理');
  assert.equal(humanInputStatus('sending', 'old-run', 'zh-CN', activity), '发送中');
});

test('input wait reasons are available in English', () => {
  assert.equal(humanInputStatus('received', 'run', 'en-US', { runId: 'run', phase: 'tool-exec' }),
    'Received · waiting for the current tool to finish');
  assert.equal(humanInputStatus('received', 'run', 'en-US', { runId: 'run', compacting: true }),
    'Received · waiting for compaction to finish');
  assert.equal(humanInputStatus('included', 'run', 'en-US', { runId: 'run', compacting: true }), 'Included in context');
});

test('skipped work exposes names separately so only identifiers and separators can be emphasized', () => {
  assert.deepEqual(summarizeSkippedInputNotice(skipped, 'zh-CN'), {
    prefix: '已跳过的工具：',
    names: 'read_file；load_skill',
    reason: '（因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  });
});
