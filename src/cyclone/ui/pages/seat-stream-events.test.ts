import assert from 'node:assert/strict';
import test from 'node:test';
import { applySeatEvent, emptyLive } from './seat-stream-events';
import { applyRoomEvent, type RoomEventState } from './room-stream-events';
import { compactionActivity } from '../../../components/common/compaction-activity';
import { visibleCycloneCompaction } from './cyclone-compaction-activity';
import { contextToDisplay } from './messageDisplay';
import { publicToFeed } from './room-messages';

test('MCP截图引用在工位与群聊实时、历史记录中按对应工具保留', () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const live = emptyLive();
  applySeatEvent({ type: 'tool-call', tool: 'mcp:desktop_observe', args: {} }, live);
  applySeatEvent({ type: 'tool-result', tool: 'mcp:desktop_observe', result: 'metadata', ok: true, toolImages }, live);
  const block = live.segments.flatMap(segment => segment.blocks)[0];
  assert.deepEqual(block.kind === 'tool' ? block.toolImages : undefined, toolImages);
  const history = contextToDisplay([
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'mcp:desktop_observe', arguments: '{}' }] },
    { role: 'tool', content: 'metadata', toolCallId: 'call-a', toolImages },
  ]);
  const storedBlock = history[0].blocks?.[0];
  assert.deepEqual(storedBlock?.kind === 'tool' ? storedBlock.toolImages : undefined, toolImages);
  const textHistory = contextToDisplay([
    { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'mcp:desktop_observe', arguments: {} }) },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'mcp:desktop_observe', content: 'metadata', ok: true }), toolImages },
  ]);
  const textBlock = textHistory[0].blocks?.[0];
  assert.deepEqual(textBlock?.kind === 'tool' ? textBlock.toolImages : undefined, toolImages);
  assert.equal(textHistory.length, 1);
  const room: RoomEventState = { roundFeed: [], activeSpeaker: '' };
  applyRoomEvent({ type: 'seat-start', speaker: '工位A' }, room);
  applyRoomEvent({ type: 'tool-call', tool: 'mcp:desktop_observe', args: {} }, room);
  applyRoomEvent({ type: 'tool-result', result: 'metadata', ok: true, toolImages }, room);
  assert.deepEqual(room.roundFeed[0].tools[0].toolImages, toolImages);
  const segment = room.roundFeed[0].segments?.[0];
  assert.deepEqual(segment?.kind === 'tools' ? segment.tools[0].toolImages : undefined, toolImages);
  const [restored] = publicToFeed([{ speaker: '工位A', content: 'done', timestamp: 1,
    toolCalls: [{ tool: 'mcp:desktop_observe', args: {}, result: 'metadata', toolImages }] }]);
  assert.deepEqual(restored.tools[0].toolImages, toolImages);
});

test('新输入清除工位与群聊的旧压缩失败，后续真实压缩仍可显示', () => {
  const old = compactionActivity({ type: 'compact-failed', id: 'old', startedAt: 1, updatedAt: 2 });
  const live = emptyLive();
  const room: RoomEventState = { roundFeed: [], activeSpeaker: '' };
  for (const event of [{ type: 'input-accepted' }, { type: 'usage', usage: null }]) {
    applySeatEvent(event, live);
    applyRoomEvent(event, room);
    assert.equal(visibleCycloneCompaction(live.compaction, old), undefined);
    assert.equal(visibleCycloneCompaction(room.compaction, old), undefined);
  }
  const start = { type: 'compact-start', id: 'new', startedAt: 3, updatedAt: 3 };
  applySeatEvent(start, live); applyRoomEvent(start, room);
  assert.equal(visibleCycloneCompaction(live.compaction, old)?.phase, 'running');
  assert.equal(visibleCycloneCompaction(room.compaction, old)?.id, 'new');
});

test('工位流按每次模型调用更新计量，未知值清除上一请求', () => {
  const live = emptyLive();
  const usage = { promptTokens: 900, completionTokens: 10, totalTokens: 910 };
  applySeatEvent({ type: 'usage', usage }, live);
  assert.deepEqual(live.tokenUsage, usage);
  applySeatEvent({ type: 'usage', usage: null }, live);
  assert.equal(live.tokenUsage, null);
});

test('实时联络接入回执不是完成，后续查询更新同一张联络卡', () => {
  const live = emptyLive();
  applySeatEvent({ type: 'contact-start', contactId: 'live-1', target: '主管', message: '汇报进展' }, live);
  applySeatEvent({ type: 'contact-done', contactId: 'live-1', ok: true,
    reply: JSON.stringify({ contactId: 'contact-1', status: 'running', delivered: true }) }, live);
  const block = live.segments[0].blocks[0];
  assert.equal(block.kind === 'contact' ? block.status : null, 'running');
  applySeatEvent({ type: 'tool-result', tool: 'contact_read', ok: true,
    result: JSON.stringify({ id: 'contact-1', status: 'completed', delivered: true, response: '已收到汇报' }) }, live);
  assert.equal(block.kind === 'contact' ? block.status : null, 'success');
  assert.equal(block.kind === 'contact' ? block.reply : null, '已收到汇报');
});

test('主管普通工具流联络复用专用卡片，待处理票据可被查询更新且不生成重复工具卡', () => {
  const live = emptyLive();
  applySeatEvent({ type: 'tool-call', tool: 'contact', args: { target: '资料员', message: '核查来源' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'contact', ok: true,
    result: JSON.stringify({ contactId: 'c-supervisor', status: 'running', delivered: true }) }, live);
  assert.equal(live.segments[0].blocks.length, 1);
  const contact = live.segments[0].blocks[0];
  assert.equal(contact.kind, 'contact');
  assert.equal(contact.kind === 'contact' ? contact.communicationId : null, 'c-supervisor');
  assert.equal(contact.kind === 'contact' ? contact.status : null, 'running');
  applySeatEvent({ type: 'tool-call', tool: 'contact_read', args: { contactId: 'c-supervisor' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'contact_read', ok: true,
    result: JSON.stringify({ contactId: 'c-supervisor', status: 'completed', delivered: true, reply: '来源已核实' }) }, live);
  assert.equal(contact.kind === 'contact' ? contact.status : null, 'success');
  assert.equal(contact.kind === 'contact' ? contact.reply : null, '来源已核实');
  assert.deepEqual(live.segments.flatMap(segment => segment.blocks).map(block => block.kind), ['contact', 'tool']);
});

test('主管联络忙线如实显示未送达，不误完成前一个普通工具', () => {
  const live = emptyLive();
  applySeatEvent({ type: 'tool-call', tool: 'read_file', args: { path: 'a' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'read_file', ok: true, result: '原始资料' }, live);
  applySeatEvent({ type: 'tool-call', tool: 'contact', args: { target: '资料员', message: '核查' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'contact', ok: false,
    result: JSON.stringify({ contactId: 'c-busy', status: 'busy', delivered: false }) }, live);
  const [tool, contact] = live.segments[0].blocks;
  assert.equal(tool.kind === 'tool' ? tool.result : null, '原始资料');
  assert.equal(contact.kind === 'contact' ? contact.deliveryState : null, 'busy');
  assert.equal(contact.kind === 'contact' ? contact.status : null, 'error');
});
