import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildVirtualToolDefs, shouldAttachToolCaller } from './virtual-tools.js';

test('没有本地工具时仍为可见的虚拟工具挂载执行器', () => {
  const visibleTools = buildVirtualToolDefs();
  assert.equal(shouldAttachToolCaller(visibleTools, false), true);
});

test('完全没有可见工具或拦截器时不挂载执行器', () => {
  assert.equal(shouldAttachToolCaller([], false), false);
});

test('工具注册只在季风可交互会话中可见', () => {
  const interactive = buildVirtualToolDefs(true).map(tool => tool.name);
  const unattended = buildVirtualToolDefs(false).map(tool => tool.name);
  assert.equal(interactive.includes('register_tool'), true);
  assert.equal(unattended.includes('register_tool'), false);
  assert.equal(interactive.includes('create_automation'), false);
  assert.equal(interactive.includes('update_automation'), false);
  assert.equal(interactive.includes('list_automations'), false);
  assert.equal(interactive.includes('create_workflow'), false);
  assert.equal(interactive.includes('update_workflow'), false);
  assert.equal(interactive.includes('list_workflows'), false);
  assert.equal(interactive.includes('list_agents'), false);
});

test('无人值守入口可以移除 ask 与 delegate', () => {
  const tools = buildVirtualToolDefs(false, {
    allowAsk: false,
    allowDelegate: false,
  }).map(tool => tool.name);

  assert.equal(tools.includes('ask'), false);
  assert.equal(tools.includes('delegate'), false);
});

test('协作总览只向可交互主入口提供', () => {
  const main = buildVirtualToolDefs(true, {
    allowDelegate: false, allowFrameworkStatus: true,
  }).map(tool => tool.name);
  const worker = buildVirtualToolDefs(true, {
    allowDelegate: false, allowFrameworkStatus: false,
  }).map(tool => tool.name);
  assert.equal(main.includes('framework_status'), true);
  assert.equal(main.includes('framework_guide'), true);
  assert.equal(worker.includes('framework_status'), false);
  assert.equal(worker.includes('framework_guide'), false);
  const dispatcher = fs.readFileSync('src/engine/conversation/session-tool-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /executeFrameworkStatus[\s\S]*!input\.mainAgent \|\| !input\.sessionId/);
});

test('框架指南示例使用真实能力 ID，状态快照不冒充可调用能力清单', () => {
  const tools = buildVirtualToolDefs(true, { allowFrameworkStatus: true });
  const guide = tools.find(tool => tool.name === 'framework_guide');
  const status = tools.find(tool => tool.name === 'framework_status');
  assert.match(JSON.stringify(guide?.parameters), /tradewind/);
  assert.doesNotMatch(JSON.stringify(guide?.parameters), /workflow、tide/);
  assert.doesNotMatch(status?.description ?? '', /当前开放的协作能力/);
});
