import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync('src/tradewind/ui/chat/AgentChatWindow.tsx', 'utf8');
const view = fs.readFileSync('src/tradewind/ui/chat/AgentChatView.tsx', 'utf8');
const surface = `${component}\n${view}`;
const reasoning = fs.readFileSync('src/tradewind/ui/chat/TwReasoningBlock.tsx', 'utf8');
const toolActivity = fs.readFileSync('src/tradewind/ui/chat/TwToolActivityGroup.tsx', 'utf8');
const styles = fs.readFileSync('src/styles/components/tradewind-panels.css', 'utf8');

test('信风 Agent 会话保持独立 UI 实现', () => {
  assert.doesNotMatch(surface, /components\/chat/);
  assert.match(view, /TwToolActivityGroup/);
  assert.match(view, /tw-chat-status/);
});

test('信风迷你会话包含季风式独立视觉层级', () => {
  assert.match(styles, /\.tw-chat-row--user \.tw-chat-bubble[\s\S]*background:\s*var\(--glass-bg\)/);
  assert.match(styles, /\.tw-chat-row--user \.tw-chat-bubble[\s\S]*0 0 0 1px rgba\(255,\s*255,\s*255,\s*0\.28\)/);
  assert.match(styles, /\.tw-chat-row--assistant \.tw-chat-bubble[\s\S]*backdrop-filter:/);
  assert.match(styles, /\.tw-chat-window__composer/);
  assert.match(styles, /\.tw-chat-status/);
});

test('信风 Agent 会话消费并展示独立思考流', () => {
  assert.match(component, /type: 'reasoning'/);
  assert.match(component, /reasoningContent/);
  assert.match(reasoning, /tw-chat-reasoning/);
  assert.match(styles, /\.tw-chat-reasoning/);
  assert.match(component, /requestAnimationFrame/);
  assert.match(component, /flushStreamFrame/);
});

test('信风运行与失败工具面板允许用户手动收起', () => {
  assert.doesNotMatch(toolActivity, /open=\{running\}/);
  assert.match(toolActivity, /onToggle=/);
});
