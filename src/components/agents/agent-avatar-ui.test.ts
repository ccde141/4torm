import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(file, 'utf8');

test('控制台、季风与对流共享 AgentAvatar，其他功能区不扩散', () => {
  assert.match(read('src/components/agents/AgentCard.tsx'), /<AgentAvatar agent=\{agent\}/);
  assert.match(read('src/components/chat/MessageItem.tsx'), /<AgentAvatar agent=\{agent\}/);
  assert.match(read('src/convection/ui/pages/ConvectionTurnCard.tsx'), /<AgentAvatar agent=\{agent\}/);
  assert.doesNotMatch(read('src/cyclone/ui/pages/SeatTurnCard.tsx'), /AgentAvatar/);
  assert.doesNotMatch(read('src/tradewind/ui/chat/AgentChatWindow.tsx'), /AgentAvatar/);
  assert.doesNotMatch(read('src/tide/ui/TidePage.tsx'), /AgentAvatar/);
});

test('季风完成态主渲染路径把当前 Agent 传给统一头像', () => {
  const item = read('src/components/chat/MessageItem.tsx');
  const structured = read('src/components/chat/StructuredMessage.tsx');
  assert.match(item, /<StructuredMessage[\s\S]*?agent=\{agent\}/);
  assert.match(structured, /<AgentAvatar agent=\{agent\}/);
  assert.doesNotMatch(structured, /<div className="chat__avatar">AI<\/div>/);
});

test('Agent 头像文件保持在 Git 忽略的运行数据目录', () => {
  const output = execFileSync('git', ['check-ignore', 'data/agents/example/profile/avatar.webp'], { encoding: 'utf8' });
  assert.match(output, /data\/agents\/example\/profile\/avatar\.webp/);
});
