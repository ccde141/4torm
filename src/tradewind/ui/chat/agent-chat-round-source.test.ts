import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync('src/tradewind/ui/chat/AgentChatWindow.tsx', 'utf8');

test('重连时从快照恢复信封轮身份而不是显示停止按钮', () => {
  assert.match(chat, /roundSource\?: 'human' \| 'envelope' \| 'contact' \| null/);
  assert.match(chat, /setRoundSource\(snap\.roundSource \?\?/);
});
