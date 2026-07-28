import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync('src/tradewind/ui/chat/AgentChatWindow.tsx', 'utf8');
const reasoning = fs.readFileSync('src/tradewind/ui/chat/TwReasoningBlock.tsx', 'utf8');
const styles = fs.readFileSync('src/styles/components/tradewind-panels.css', 'utf8');

test('信风 Agent 会话保持独立 UI 实现', () => {
  assert.doesNotMatch(component, /components\/chat/);
  assert.match(component, /TwToolActivityGroup/);
  assert.match(component, /tw-chat-status/);
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
