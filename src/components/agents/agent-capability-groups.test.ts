import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDef } from '../../store/tools.js';
import {
  groupAgentTools,
  getCapabilitySelectionState,
  toggleCapabilitySelection,
  normalizeCapabilitySelection,
  toggleCapabilityTool,
} from './agent-capability-groups.js';

const capability = {
  id: 'tradewind', title: '信风工作流', route: '有明确节点和交接时使用',
};

const tools: ToolDef[] = [
  { name: 'read_file', description: 'read', category: 'io', dangerous: false,
    executorType: 'builtin', parameters: {}, source: 'framework', readonly: true },
  { name: 'tradewind_start', description: 'start', category: 'system', dangerous: false,
    executorType: 'builtin', parameters: {}, source: 'framework', readonly: true,
    frameworkCapability: capability },
  { name: 'tradewind_status', description: 'status', category: 'system', dangerous: false,
    executorType: 'builtin', parameters: {}, source: 'framework', readonly: true,
    frameworkCapability: capability },
  { name: 'custom_spoof', description: 'custom', category: 'custom', dangerous: false,
    executorType: 'custom', parameters: {}, source: 'custom', readonly: false,
    frameworkCapability: capability },
];

test('只把可信框架工具组织为能力组', () => {
  const grouped = groupAgentTools(tools);
  assert.deepEqual(grouped.capabilities.map(group => ({
    id: group.id, names: group.tools.map(tool => tool.name),
  })), [{ id: 'tradewind', names: ['tradewind_start', 'tradewind_status'] }]);
  assert.deepEqual(grouped.standalone.map(tool => tool.name), ['read_file', 'custom_spoof']);
});

test('气旋全区开关包含后续工具，单项调整恢复精细选择且旧部分配置不扩权', () => {
  const cycloneTools = tools.map(tool => tool.frameworkCapability
    ? { ...tool, frameworkCapability: { ...tool.frameworkCapability, id: 'cyclone' } } : tool);
  const group = groupAgentTools(cycloneTools).capabilities[0];
  const old = new Set(['read_file', 'tradewind_start']);
  assert.deepEqual(normalizeCapabilitySelection(cycloneTools, old), old);
  const enabled = toggleCapabilitySelection(group, old);
  assert.deepEqual([...enabled].sort(), ['framework_capability_cyclone', 'read_file']);
  assert.equal(getCapabilitySelectionState({ ...group, tools: [...group.tools,
    { ...group.tools[0], name: 'new_action' }] }, enabled), 'on');
  assert.deepEqual([...toggleCapabilityTool(group, enabled, 'tradewind_status')].sort(), ['read_file', 'tradewind_start']);
});

test('能力组准确区分关闭、部分启用和全部启用', () => {
  const group = groupAgentTools(tools).capabilities[0];
  assert.equal(getCapabilitySelectionState(group, new Set()), 'off');
  assert.equal(getCapabilitySelectionState(group, new Set(['tradewind_start'])), 'partial');
  assert.equal(getCapabilitySelectionState(group, new Set(['tradewind_start', 'tradewind_status'])), 'on');
});

test('能力组切换保留其他工具并以全组为单位开关', () => {
  const group = groupAgentTools(tools).capabilities[0];
  const enabled = toggleCapabilitySelection(group, new Set(['read_file', 'tradewind_start']));
  assert.deepEqual([...enabled].sort(), ['read_file', 'tradewind_start', 'tradewind_status']);
  const disabled = toggleCapabilitySelection(group, enabled);
  assert.deepEqual([...disabled], ['read_file']);
});

test('潮汐只保存稳定能力开关，旧版单项选择也可一次迁移', () => {
  const tideTools = tools.map(tool => tool.frameworkCapability
    ? { ...tool, frameworkCapability: { ...tool.frameworkCapability, id: 'tide' } } : tool);
  const group = groupAgentTools(tideTools).capabilities[0];
  const old = new Set(['read_file', 'tradewind_start']);
  assert.equal(getCapabilitySelectionState(group, old), 'on');
  const disabled = toggleCapabilitySelection(group, old);
  assert.deepEqual([...disabled], ['read_file']);
  const enabled = toggleCapabilitySelection(group, disabled);
  assert.deepEqual([...enabled].sort(), ['framework_capability_tide', 'read_file']);
  assert.deepEqual([...normalizeCapabilitySelection(tideTools, old)].sort(),
    ['framework_capability_tide', 'read_file']);
});

test('对流能力一键开放当前及后续操作，旧版部分选择不被擅自扩权', () => {
  const group = groupAgentTools(tools.map(tool => tool.frameworkCapability
    ? { ...tool, frameworkCapability: { ...tool.frameworkCapability, id: 'convection' } }
    : tool)).capabilities[0];
  const old = new Set(['read_file', 'tradewind_start']);
  assert.equal(getCapabilitySelectionState(group, old), 'partial');
  const enabled = toggleCapabilitySelection(group, old);
  assert.deepEqual([...enabled].sort(), ['framework_capability_convection', 'read_file']);
  assert.deepEqual([...toggleCapabilitySelection(group, enabled)], ['read_file']);
});
