import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { applyChairReply } from './chair-round.js';

function session(): ConvectionSessionData {
  return {
    id: 'meeting', title: '会议', topic: '测试', chairAgentId: 'chair',
    participantAgentIds: [], publicMessages: [], chairMessages: [],
    createdAt: '', updatedAt: '',
  };
}

test('空正文仍先保存并推送提供商实际用量，然后报告协议错误', async () => {
  const target = session();
  const snapshots: ConvectionSessionData[] = [];
  const events: Array<{ type: string; usage?: { promptTokens: number } }> = [];
  const usage = { promptTokens: 680, completionTokens: 0, totalTokens: 680 };
  await assert.rejects(
    applyChairReply(target, { content: '', usage },
      async () => { snapshots.push(structuredClone(target)); },
      event => events.push(event)),
    error => (error as { data?: { code?: string } }).data?.code === 'MODEL_EMPTY_RESPONSE',
  );
  assert.equal(snapshots[0].chairTokenUsage?.promptTokens, 680);
  assert.equal(target.chairMessages.length, 0);
  assert.deepEqual(events, [{ type: 'usage', usage }]);
});

test('正常正文仍与用量一起落盘并发完成事件', async () => {
  const target = session();
  const events: string[] = [];
  const usage = { promptTokens: 700, completionTokens: 20, totalTokens: 720 };
  await applyChairReply(target, { content: '答复', usage }, async () => {
    assert.equal(target.chairTokenUsage?.promptTokens, 700);
    assert.equal(target.chairMessages.at(-1)?.content, '答复');
  }, event => { events.push(event.type); }, 'run-a');
  assert.equal(target.chairMessages.at(-1)?.runId, 'run-a');
  assert.deepEqual(events, ['usage', 'chair-done']);
});
