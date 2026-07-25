import assert from 'node:assert/strict';
import { buildTaskBoardSection } from './taskboard';
import { buildWorkflowToolsSection } from './workflow-builder';

function assertNoLegacyXml(prompt: string): void {
  assert.doesNotMatch(prompt, /<action|<answer|<think|<result/);
}

function run(name: string, test: () => void): void {
  test();
  console.log(`  ✓ ${name}`);
}

console.log('共享提示词结构化协议');

run('文本任务板使用 JSON 调用信封', () => {
  const prompt = buildTaskBoardSection(null, false);
  assert.match(prompt, /"type":"tool_call","name":"task_board"/);
  assertNoLegacyXml(prompt);
});

run('native 任务板不教授文本 transport', () => {
  const prompt = buildTaskBoardSection(null, true);
  assert.doesNotMatch(prompt, /"type":"tool_call"/);
  assertNoLegacyXml(prompt);
});

run('文本工作流工具使用 JSON 调用信封', () => {
  const prompt = buildWorkflowToolsSection(false);
  assert.match(prompt, /"type":"tool_call","name":"create_workflow"/);
  assertNoLegacyXml(prompt);
});

run('native 工作流工具不教授文本 transport', () => {
  const prompt = buildWorkflowToolsSection(true);
  assert.doesNotMatch(prompt, /"type":"tool_call"/);
  assertNoLegacyXml(prompt);
});

console.log('ok');
