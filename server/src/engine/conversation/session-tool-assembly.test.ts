import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleSessionToolSets } from './session-tool-assembly.js';

test('运行时只暴露超级工具而能力指南保留获准 action Schema', () => {
  const base = {
    loaded: [], interactive: true, mainAgent: true,
    allowAsk: false, allowDelegate: false,
  };
  const compact = [{
    name: 'framework_capability_tradewind', description: '信风统一入口', parameters: {},
  }];
  const actions = [{
    name: 'start_workflow', description: '启动工作流', parameters: { type: 'object' },
  }];
  const sets = assembleSessionToolSets({
    ...base, extensionTools: compact, guideExtensionTools: actions,
  });

  assert.equal(sets.runtime.some(tool => tool.name === 'framework_capability_tradewind'), true);
  assert.equal(sets.runtime.some(tool => tool.name === 'start_workflow'), false);
  assert.equal(sets.guide.some(tool => tool.name === 'framework_capability_tradewind'), false);
  assert.equal(sets.guide.some(tool => tool.name === 'start_workflow'), true);
});

test('没有会话定位的入口不提供会话任务板', () => {
  const unattended = assembleSessionToolSets({
    loaded: [], interactive: false, mainAgent: false,
    allowAsk: false, allowDelegate: false,
  });
  assert.equal(unattended.runtime.some(tool => tool.name === 'task_board'), false);
  const interactive = assembleSessionToolSets({
    loaded: [], interactive: true, mainAgent: false,
  });
  assert.equal(interactive.runtime.some(tool => tool.name === 'task_board'), true);
});


test('memory has exactly three public entries even when recall extensions are attached', () => {
  const tools = assembleSessionToolSets({ loaded: [], interactive: true, mainAgent: true,
    extensionTools: [{ name: 'recall_read', description: 'extension', parameters: {} }],
  }).runtime;
  assert.deepEqual(tools.filter(tool => /^(memory_|recall_)/.test(tool.name)).map(tool => tool.name).sort(),
    ['memory_manage', 'recall_read', 'recall_search']);
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
});
