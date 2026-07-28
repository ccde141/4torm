import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { partitionCycloneToolActivity } from './cyclone-tool-activity.js';

test('气旋只合并连续普通工具，系统工具保持独立', () => {
  const parts = partitionCycloneToolActivity([
    { tool: 'read_file' },
    { tool: 'write_file' },
    { tool: 'use_skill' },
    { tool: 'delegate' },
    { tool: 'run_command' },
    { tool: 'edit_file' },
  ]);

  assert.deepEqual(parts.map(part => ({
    kind: part.kind,
    tools: part.items.map(item => item.tool),
  })), [
    { kind: 'group', tools: ['read_file', 'write_file'] },
    { kind: 'single', tools: ['use_skill'] },
    { kind: 'single', tools: ['delegate'] },
    { kind: 'group', tools: ['run_command', 'edit_file'] },
  ]);
});

test('Ask 回答后的普通工具重新形成独立工具组', () => {
  const parts = partitionCycloneToolActivity([
    { tool: 'read_file' },
    { tool: 'write_file' },
    { tool: 'ask' },
    { tool: 'run_command' },
    { tool: 'edit_file' },
  ]);

  assert.deepEqual(parts.map(part => ({
    kind: part.kind,
    tools: part.items.map(item => item.tool),
  })), [
    { kind: 'group', tools: ['read_file', 'write_file'] },
    { kind: 'single', tools: ['ask'] },
    { kind: 'group', tools: ['run_command', 'edit_file'] },
  ]);
});

test('气旋工具组不复用季风带分隔线的容器材质', () => {
  const component = fs.readFileSync('src/cyclone/ui/pages/CycloneToolActivityList.tsx', 'utf8');
  const styles = fs.readFileSync('src/cyclone/ui/pages/cyclone-tool-activity.css', 'utf8');

  assert.doesNotMatch(component, /components\/chat\/ToolActivityGroup/);
  assert.doesNotMatch(component, /className="tool-activity-group/);
  assert.doesNotMatch(styles, /border(?:-top)?\s*:/);
});

test('气旋工具组像季风一样横跨会话内容宽度', () => {
  const styles = fs.readFileSync('src/cyclone/ui/pages/cyclone-tool-activity.css', 'utf8');

  assert.match(styles, /\.cyclone-tool-activity__summary[\s\S]*width:\s*100%/);
  assert.doesNotMatch(styles, /width:\s*fit-content/);
});
