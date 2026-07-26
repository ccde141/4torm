import assert from 'node:assert/strict';
import test from 'node:test';
import { isFrameworkTool, partitionToolActivity } from './tool-activity-group.js';

test('框架工具始终保持独立', () => {
  for (const name of [
    'ask', 'delegate', 'contact', 'dispatch', 'bulletin', 'task_board',
    'register_tool', 'register_skill', 'review_changes', 'list_agents',
    'create_workflow', 'list_workflows', 'update_workflow', 'complete_task',
    'create_automation', 'update_automation', 'list_automations',
    'envelope_add', 'envelope_remove', 'envelope_list',
  ]) {
    assert.equal(isFrameworkTool(name), true, name);
  }
  assert.equal(isFrameworkTool('read_file'), false);
});

test('每种框架工具只切断当前位置，后续普通工具会重新成组', () => {
  const frameworkTools = [
    'ask', 'delegate', 'contact', 'dispatch', 'bulletin', 'task_board',
    'register_tool', 'register_skill', 'review_changes', 'list_agents',
    'create_workflow', 'list_workflows', 'update_workflow', 'complete_task',
    'create_automation', 'update_automation', 'list_automations',
    'envelope_add', 'envelope_remove', 'envelope_list',
  ];
  for (const frameworkTool of frameworkTools) {
    const parts = partitionToolActivity([
      { tool: 'read_file' }, { tool: 'write_file' }, { tool: frameworkTool },
      { tool: 'run_command' }, { tool: 'edit_file' },
    ]);
    assert.deepEqual(parts.map(part => [part.kind, part.items.map(item => item.tool)]), [
      ['group', ['read_file', 'write_file']],
      ['single', [frameworkTool]],
      ['group', ['run_command', 'edit_file']],
    ], frameworkTool);
  }
});

test('只折叠同一回复内连续的两个以上普通工具', () => {
  const parts = partitionToolActivity([
    { tool: 'read_file' }, { tool: 'write_file' }, { tool: 'contact' },
    { tool: 'run_command' }, { tool: 'delegate' }, { tool: 'read_file' }, { tool: 'edit_file' },
  ]);
  assert.deepEqual(parts.map(part => [part.kind, part.items.map(item => item.tool)]), [
    ['group', ['read_file', 'write_file']],
    ['single', ['contact']],
    ['single', ['run_command']],
    ['single', ['delegate']],
    ['group', ['read_file', 'edit_file']],
  ]);
});
