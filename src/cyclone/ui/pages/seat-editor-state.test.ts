import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeatDraft } from './SeatPanel';
import { resolveLoadedSeatEditor } from './seat-editor-state';

const draft = { agentId: 'agent-a', title: '后端', rolePrompt: '', duty: '', overrideAgentRole: false } satisfies SeatDraft;

test('只允许当前加载中的工位进入编辑页', () => {
  const current = { kind: 'loading-seat' as const, id: 'seat-b' };

  assert.equal(resolveLoadedSeatEditor(current, 'seat-a', draft), current);
  assert.deepEqual(resolveLoadedSeatEditor(current, 'seat-b', draft), {
    kind: 'edit-seat', id: 'seat-b', draft,
  });
});

test('用户已切回聊天时旧请求不能重新打开编辑页', () => {
  const current = { kind: 'seat' as const, id: 'seat-b' };

  assert.equal(resolveLoadedSeatEditor(current, 'seat-a', draft), current);
});
