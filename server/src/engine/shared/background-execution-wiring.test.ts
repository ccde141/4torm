import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildBackgroundExecutionToolDefs, withBackgroundExecutionGuidance } from './background-execution-tools.js';

const srcRoot = path.resolve(import.meta.dirname, '..');

test('后台控制工具使用统一静态定义', () => {
  assert.deepEqual(
    buildBackgroundExecutionToolDefs().map(tool => tool.name),
    ['inspect_execution', 'wait_execution', 'terminate_execution'],
  );
});

test('实际开放后台生命周期时，Agent 能从可后台化工具说明获知控制方式', () => {
  const tools = withBackgroundExecutionGuidance([
    { name: 'short_tool', description: '短工具', executionMode: 'sync' },
    { name: 'long_tool', description: '长工具', executionMode: 'detachable' },
  ]);
  assert.equal(tools[0].description, '短工具');
  assert.match(tools[1].description, /约 3 秒/);
  assert.match(tools[1].description, /executionId/);
  assert.match(tools[1].description, /inspect_execution/);
  assert.match(tools[1].description, /wait_execution/);
  assert.match(tools[1].description, /terminate_execution/);
});

test('季风仅在有会话身份时开放后台控制，潮汐不会继承该能力', () => {
  const session = fs.readFileSync(path.join(srcRoot, 'conversation', 'session-runner.ts'), 'utf8');
  const tide = fs.readFileSync(path.join(srcRoot, '..', 'services', 'tide', 'runner.ts'), 'utf8');
  assert.match(session, /this\.opts\.sessionId \? buildBackgroundExecutionToolDefs\(\) : \[\]/);
  assert.match(session, /this\.opts\.sessionId[\s\S]*withBackgroundExecutionGuidance\(loadedToolDefs\)/);
  assert.doesNotMatch(tide, /buildBackgroundExecutionToolDefs|inspect_execution|wait_execution|terminate_execution/);
});

test('气旋只在工位私聊驱动中开放后台控制并使用工位所有者', () => {
  const seat = fs.readFileSync(path.join(srcRoot, 'cyclone', 'seat-runner.ts'), 'utf8');
  const room = fs.readFileSync(path.join(srcRoot, 'cyclone', 'room-runner.ts'), 'utf8');
  const contact = fs.readFileSync(path.join(srcRoot, 'cyclone', 'contact.ts'), 'utf8');
  assert.match(seat, /buildBackgroundExecutionToolDefs\(\)/);
  assert.match(seat, /withBackgroundExecutionGuidance\(toolDefs\)/);
  assert.match(seat, /ownerId: `\$\{workshopId\}:\$\{seatId\}`/);
  assert.doesNotMatch(room, /buildBackgroundExecutionToolDefs/);
  assert.doesNotMatch(contact, /buildBackgroundExecutionToolDefs/);
});
