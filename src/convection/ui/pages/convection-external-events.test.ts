import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExternalChairEvent, applyExternalPublicEvent, restoreConvectionCompaction, restoreConvectionPublicDraft } from './convection-external-events.js';
import { restoreConvectionMessage } from './convection-message-map.js';

test('MCP图片在实时工具结果、终答和历史恢复时保留在同一次调用内', () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const identity = { agentId: 'agent-a', label: '研究员' };
  const started = applyExternalPublicEvent([], { type: 'tool-call', ...identity, tool: 'mcp:observe', args: {} });
  const completed = applyExternalPublicEvent(started, { type: 'tool-result', ...identity,
    tool: 'mcp:observe', result: 'metadata', toolImages });
  assert.deepEqual(completed[0].toolCalls?.[0].toolImages, toolImages);
  const done = applyExternalPublicEvent(completed, { type: 'agent-done', ...identity, content: 'seen',
    toolCalls: [{ tool: 'mcp:observe', args: {}, result: 'metadata', toolImages }] });
  assert.deepEqual(done[0].toolCalls?.[0].toolImages, toolImages);
  assert.deepEqual(restoreConvectionMessage({ speaker: '研究员', content: 'seen',
    toolCalls: [{ tool: 'mcp:observe', args: {}, result: 'metadata', toolImages }] }).toolCalls?.[0].toolImages, toolImages);
});

test('请求中断只核对保存状态，提交已完成时不把压缩误报为已取消', () => {
  const pending = { id: 'manual-a', phase: 'running' as const, operation: 'compact' as const,
    startedAt: 1, updatedAt: 2, message: '正在核对已保存状态' };
  const start = { type: 'compact-start', id: 'server-a', startedAt: 1, updatedAt: 1 };
  assert.equal(restoreConvectionCompaction(pending, start)?.message, pending.message);
  assert.equal(restoreConvectionCompaction(pending, { ...start, type: 'compact-done', updatedAt: 3 })?.phase, 'completed');
  assert.equal(restoreConvectionCompaction(pending, { ...start, type: 'compact-failed', aborted: true, updatedAt: 3 })?.phase, 'cancelled');
});

test('压缩进度不伪装成公共发言或助理回复', () => {
  const messages = [{ speaker: '人类', content: '正在讨论' }];
  const chair = [{ role: 'user', content: '私人问题' }];
  for (const type of ['compact-start', 'compact-done', 'compact-failed'] as const) {
    assert.equal(applyExternalPublicEvent(messages, { type, id: 'compact-a' }), messages);
    assert.equal(applyExternalChairEvent(chair, { type, id: 'compact-a' }), chair);
  }
});

test('successful public compaction attaches one boundary without discarding received work', () => {
  const messages = [{ agentId: 'agent-a', speaker: '研究员', content: '先前说明', streaming: true,
    reasoning: '先前思考', toolCalls: [{ tool: 'read', args: {}, result: 'evidence', status: 'done' as const }] }];
  const boundary = { id: 'compact-one', summary: '交接', toolOffset: 1, textOffset: 4, reasoningOffset: 4 };
  const event = { type: 'compact-done' as const, agentId: 'agent-a', boundary };
  const updated = applyExternalPublicEvent(messages, event);
  assert.equal(updated[0].content, messages[0].content);
  assert.deepEqual(updated[0].toolCalls, messages[0].toolCalls);
  assert.deepEqual(updated[0].compactions, [boundary]);
  assert.deepEqual(applyExternalPublicEvent(updated, event), updated);
  const restored = restoreConvectionMessage({ ...updated[0], timestamp: 1 });
  assert.deepEqual(restored.compactions, [boundary]);
});

test('后台会议的逐字发言在前端形成流式卡片并由终答收口', () => {
  const start = applyExternalPublicEvent([], {
    type: 'agent-start', agentId: 'agent-a', label: '研究员',
  });
  const streaming = applyExternalPublicEvent(start, {
    type: 'token', agentId: 'agent-a', label: '研究员', chunk: '正在核对',
  });
  assert.equal(streaming[0]?.content, '正在核对');
  assert.equal(streaming[0]?.streaming, true);
  const done = applyExternalPublicEvent(streaming, {
    type: 'agent-done', agentId: 'agent-a', label: '研究员',
    content: '核对完成', rawContent: '核对完成', toolCalls: [],
  });
  assert.equal(done[0]?.content, '核对完成');
  assert.equal(done[0]?.streaming, false);
});

test('failed participant keeps received prose and tool evidence with a distinct failure status', () => {
  const messages = [{ agentId: 'agent-a', speaker: '研究员', content: '已经收到的过程', streaming: true,
    toolCalls: [{ tool: 'read', args: {}, result: '证据', status: 'done' as const }] }];
  const failed = applyExternalPublicEvent(messages,
    { type: 'agent-failed', agentId: 'agent-a', label: '研究员', message: '模型请求失败' });
  assert.equal(failed[0].content, messages[0].content);
  assert.deepEqual(failed[0].toolCalls, messages[0].toolCalls);
  assert.deepEqual(failed[0].execution, { status: 'failed', message: '模型请求失败' });
  assert.equal(restoreConvectionMessage({ ...failed[0], timestamp: 1 }).execution?.status, 'failed');
});

test('active restore merges live prose into the durable compression draft without a duplicated bubble', () => {
  const boundary = { id: 'compact-one', summary: '交接', toolOffset: 1, textOffset: 4, reasoningOffset: 0 };
  const draft = { speaker: '研究员', content: '压缩前文', execution: { status: 'running' as const }, compactions: [boundary],
    toolCalls: [{ tool: 'read', args: {}, result: '证据', status: 'done' as const }] };
  const restored = restoreConvectionPublicDraft([draft], { speaker: '研究员', content: '压缩前文压缩后文', complete: false });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].content, '压缩前文压缩后文');
  assert.deepEqual(restored[0].compactions, [boundary]);
  assert.deepEqual(restored[0].toolCalls, draft.toolCalls);
  assert.equal(restored[0].streaming, true);
});

test('中途订阅时缺失 agent-start 仍能显示后续片段；助理私聊也逐字更新', () => {
  const publicMessages = applyExternalPublicEvent([], {
    type: 'token', agentId: 'agent-a', label: '研究员', chunk: '续写',
  });
  assert.equal(publicMessages[0]?.content, '续写');
  const resumed = applyExternalPublicEvent([{
    speaker: '研究员', content: '已有', streaming: true,
  }], { type: 'token', agentId: 'agent-a', label: '研究员', chunk: '续写' });
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.content, '已有续写');
  const chair = applyExternalChairEvent([], { type: 'chair-token', chunk: '先看' });
  assert.equal(chair[0]?.content, '先看');
  assert.equal(applyExternalChairEvent(chair, {
    type: 'chair-done', content: '先看事实',
  })[0]?.streaming, false);
});
