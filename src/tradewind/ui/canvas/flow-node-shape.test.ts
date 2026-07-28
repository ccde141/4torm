import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const gate = fs.readFileSync('src/tradewind/ui/canvas/nodes/HumanGateNode.tsx', 'utf8');
const output = fs.readFileSync('src/tradewind/ui/canvas/nodes/OutputNode.tsx', 'utf8');
const canvas = fs.readFileSync('src/tradewind/ui/canvas/TradeWindCanvas.tsx', 'utf8');
const page = fs.readFileSync('src/tradewind/ui/pages/TradeWindPage.tsx', 'utf8');
const styles = fs.readFileSync('src/styles/components/tradewind.css', 'utf8');
const panelStyles = fs.readFileSync('src/styles/components/tradewind-panels.css', 'utf8');

test('暂停点采用紧凑状态条并使用明确介入动作', () => {
  assert.match(gate, /tw-node__state-line/);
  assert.match(gate, /等待人工确认/);
  assert.match(gate, /等待信封/);
  assert.match(gate, /审查并继续/);
  assert.doesNotMatch(gate, /✏️ 编辑/);
});

test('暂停点默认态与悬停态都使用琥珀玻璃材质', () => {
  assert.match(styles, /\.tw-node--gate\s*\{[^}]*background:\s*linear-gradient\([^}]*rgba\(245,\s*158,\s*11/s);
  assert.match(styles, /\.tw-node--gate:hover\s*\{[^}]*background:/s);
});

test('output 节点消费工作流终态并等待信封全量交接', () => {
  assert.match(canvas, /executionPhase/);
  assert.match(output, /runtimePhase/);
  assert.match(output, /等待信封全量交接/);
  assert.doesNotMatch(output, /等待工作流抵达/);
  assert.match(output, /已到达出口/);
  assert.match(output, /未到达出口/);
});

test('信风近期持续态接入集中 motion 节拍', () => {
  assert.match(styles, /\.tw-node--gate-waiting\s*\{[^}]*var\(--motion-loop-duration\)[^}]*var\(--motion-loop-ease\)/s);
  assert.match(panelStyles, /\.tw-meeting-panel__nav-pulse\s*\{[^}]*var\(--motion-loop-duration\)[^}]*var\(--motion-loop-ease\)/s);
  assert.match(panelStyles, /\.tw-meeting-panel__status--active[^}]*var\(--motion-loop-duration\)[^}]*var\(--motion-loop-ease\)/s);
});

test('其他工作流运行时工具栏保持真实运行态但当前 output 不串状态', () => {
  assert.match(page, /currentWorkflowPhase/);
  assert.match(page, /toolbarPhase/);
  assert.match(page, /execution\.running \? execution\.phase : currentWorkflowPhase/);
  assert.match(page, /executionPhase=\{currentWorkflowPhase\}/);
});
