import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveMessage } from '../../i18n/locale.js';

const read = (name: string) => readFileSync(`src/components/agents/${name}`, 'utf8');

test('已有 Agent 的状态、配置、记忆共用详情导航，不再切到独立弹窗', () => {
  const dashboard = read('DashboardPage.tsx');
  const detail = read('AgentDetailDialog.tsx');
  assert.doesNotMatch(dashboard, /configAgent|memoryAgent|<MemoryPanel/);
  assert.match(detail, /<AgentDetailNav/);
  assert.match(detail, /<AgentConfigModal[\s\S]*mode="embedded"/);
  assert.match(detail, /<MemoryPanel[\s\S]*embedded/);
  assert.match(detail, /agent-detail__section/);
});

test('配置草稿跨导航保持挂载，嵌入状态不建立第二层遮罩或 Escape 监听', () => {
  const detail = read('AgentDetailDialog.tsx');
  const config = read('AgentConfigModal.tsx');
  assert.match(detail, /hidden=\{!configSection\}/);
  assert.match(config, /mode: 'embedded'/);
  assert.match(config, /if \(embedded\) return/);
  assert.match(config, /if \(embedded\) return content/);
  assert.match(config, /if \(embedded\) \{\s*setSaving\(false\)/);
  assert.match(config, /embedded \? t\('dashboard\.detail\.backOverview'\)/);
});

test('删除行为仍在详情底部，不并入导航', () => {
  const detail = read('AgentDetailDialog.tsx');
  assert.match(detail, /agent-detail__foot[\s\S]*void remove\(\)/);
  assert.match(detail, /await confirm\([\s\S]*onDelete\(\)/);
  assert.doesNotMatch(detail, /agent-detail__nav[\s\S]*setSection\('delete'\)/);
});

test('导航按概览、统计、配置、提示词、工具、技能、记忆排序，编辑内容分别显示', () => {
  const detail = read('AgentDetailDialog.tsx');
  const tabs = read('AgentConfigTabs.tsx');
  const editor = read('AgentConfigModal.tsx');
  assert.match(tabs, /\['basic', 'prompt', 'tools', 'skills'\]/);
  assert.match(detail, /overview[\s\S]*stats[\s\S]*AGENT_CONFIG_TABS\.map[\s\S]*memory/);
  assert.match(detail, /<AgentActivityOverview/);
  assert.match(detail, /<AgentActivityStats/);
  assert.match(detail, /<AgentDetailNav/);
  const prompt = editor.split("{tab === 'prompt' &&")[1]?.split("{tab === 'tools' &&")[0];
  const tools = editor.split("{tab === 'tools' &&")[1];
  assert.match(prompt ?? '', /rolePrompt/);
  assert.doesNotMatch(prompt ?? '', /AgentToolCapabilities/);
  assert.match(tools ?? '', /AgentToolCapabilities/);
  assert.doesNotMatch(tools ?? '', /rolePrompt/);
  assert.equal(resolveMessage('en-US', 'agent.tabPrompt'), 'Prompt');
  assert.equal(resolveMessage('zh-CN', 'agent.tabTools'), '工具');
});

test('详情概览以探针归属事件为入口，配置不占据概览主体', () => {
  const overview = read('AgentActivityOverview.tsx');
  const source = read('AgentActivitySource.tsx');
  const detail = read('AgentDetailDialog.tsx');
  assert.match(overview, /mergeAgentRecords\(activity, history\.records\)/);
  assert.match(source, /<AgentDetailRecords/);
  assert.doesNotMatch(detail, /agent-detail__note/);
});

test('运行记录初次请求期间显示读取中而不是空记录', () => {
  const records = read('AgentDetailRecords.tsx');
  assert.match(records, /initialLoading/);
  assert.match(records, /dashboard\.detail\.readingShort/);
});

test('配置界面不展示 Temperature 滑块，保存仍沿用已有配置值', () => {
  const config = read('AgentConfigModal.tsx');
  assert.doesNotMatch(config, /config-slider|type="range"|setTemperature/);
  assert.match(config, /temperature:\s*agent\?\.config\?\.temperature/);
});
