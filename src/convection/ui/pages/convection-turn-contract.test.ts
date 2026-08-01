import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('对流使用功能区内独立回合组件，不依赖气旋或信风实现', () => {
  const page = fs.readFileSync('src/convection/ui/pages/ConvectionPage.tsx', 'utf8');
  const turn = fs.readFileSync('src/convection/ui/pages/ConvectionTurnCard.tsx', 'utf8');

  assert.match(page, /ConvectionTurnCard/);
  assert.doesNotMatch(page, /StructuredMessage|AgentTurnCard/);
  assert.doesNotMatch(turn, /cyclone|tradewind|StructuredMessage|AgentTurnCard/i);
});

test('对流回合在生成与完成状态下保持同一发言结构', () => {
  const turn = fs.readFileSync('src/convection/ui/pages/ConvectionTurnCard.tsx', 'utf8');
  const styles = fs.readFileSync('src/convection/ui/pages/convection-turn-card.css', 'utf8');

  assert.match(turn, /发言准备/);
  assert.match(turn, /aria-expanded=/);
  assert.match(turn, /message\.streaming/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});
