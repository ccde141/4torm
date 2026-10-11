import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeatSystemPrompt } from '../cyclone/seat-prompt.js';
import type { LoadedAgent } from './agent-loader.js';
import { buildSelfManagementSection } from './prompt.js';

const agent: LoadedAgent = {
  id: 'agent-a', name: 'Agent A', model: 'provider:model', rolePrompt: '', temperature: 0.7,
  tools: [], toolMode: 'selected', skills: [], workspace: '', sandboxLevel: 'relaxed',
};

function emptyToolSeatPrompt(native: boolean): string {
  return buildSeatSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a',
    seat: {
      id: 'seat-a', title: '工位', rolePrompt: '', agentId: agent.id,
      messages: [], createdAt: '', updatedAt: '',
    },
    agent, toolDefs: [], native, wsRelPath: 'data/cyclone/workshop-a/workspace',
  });
}

test('tool registration instructions appear only in interactive prompts', () => {
  const interactive = buildSelfManagementSection({ allowToolRegistration: true });
  const unattended = buildSelfManagementSection({ allowToolRegistration: false });
  assert.match(interactive, /## 4torm 框架导航/);
  assert.match(interactive, /docs\/architecture\//);
  assert.match(interactive, /server\/src\/tools\/framework\/catalog\.json/);
  assert.match(interactive, /data\/skills\/\{名称\}\/SKILL\.md/);
  assert.match(interactive, /data\/mcp\/servers\.json/);
  assert.match(interactive, /register_tool/);
  assert.match(interactive, /executionMode/);
  assert.match(interactive, /ctx\.signal/);
  assert.match(interactive, /detachable/);
  assert.match(interactive, /按本轮工具协议调用 `register_tool`/);
  assert.doesNotMatch(interactive, /"type":"tool_call","name":"register_tool"/);
  assert.doesNotMatch(interactive, /<action/);
  assert.doesNotMatch(interactive, /在 `data\/mcp\/servers\.json` 追加/);
  assert.doesNotMatch(unattended, /register_tool/);
});

test('native registration guidance does not teach text action tags', () => {
  const prompt = buildSelfManagementSection({ allowToolRegistration: true, native: true });
  assert.match(prompt, /register_tool/);
  assert.doesNotMatch(prompt, /<action/);
});

test('气旋工位没有显式工具时仍提供工具注册说明', () => {
  assert.match(emptyToolSeatPrompt(false), /register_tool/);
  assert.match(emptyToolSeatPrompt(true), /register_tool/);
});
