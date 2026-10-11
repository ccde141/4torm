import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoadedAgent } from '../shared/agent-loader.js';
import { buildRoomDispatchGuidance, buildSeatContactSystemPrompt, buildSeatRoomSystemPrompt } from './seat-prompt.js';

const agent: LoadedAgent = {
  id: 'agent-a', name: 'Agent A', model: 'provider:model', rolePrompt: '', temperature: 0.7,
  tools: [], toolMode: 'selected', skills: [], workspace: '', sandboxLevel: 'relaxed',
};
const seat = {
  id: 'seat-a', title: '架构', rolePrompt: '', agentId: agent.id,
  messages: [], createdAt: '', updatedAt: '',
};
const toolDefs = [{ name: 'read_file', description: '读取文件' }];

test('群聊提示词要求把明确执行项主动派发，同时避免滥发', () => {
  const guidance = buildRoomDispatchGuidance('架构', [
    { title: '架构', duty: '维护总体设计' },
    { title: '后端', duty: '实现接口' },
  ]);

  assert.match(guidance, /主动调用 dispatch/);
  assert.match(guidance, /自己的固定工位「架构」/);
  assert.match(guidance, /尚未形成共识/);
  assert.match(guidance, /contact/);
  assert.match(guidance, /没有点名目标/);
  assert.match(guidance, /默认指你自己的固定工位「架构」/);
  assert.match(guidance, /不是群聊里的其他参与者/);
  assert.match(guidance, /明确点名/);
  assert.match(guidance, /重要信息.*dispatch/);
  assert.match(guidance, /多步骤.*固定工位/);
  assert.match(guidance, /群聊.*目标.*结果摘要/);
  assert.match(guidance, /task_board.*工位私聊/);
  assert.match(guidance, /下载目录/);
  assert.match(guidance, /公告板.*简短/);
  assert.match(guidance, /一次读取.*群聊/);
  assert.doesNotMatch(guidance, /调度者按派发 ID 读取回报/);
});

test('群聊完整提示词优先选择执行场所，同时允许简短核实', () => {
  const prompt = buildSeatRoomSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a', seat, agent,
    toolDefs, native: false, wsRelPath: 'data/cyclone/workshop-a/workspace', topic: '目录调查',
    dispatchTargets: [{ title: '架构', duty: '维护总体设计' }],
  });
  assert.match(prompt, /多步骤.*固定工位/);
  assert.match(prompt, /简短核实.*工具/);
  assert.doesNotMatch(prompt, /需要时可调用工具佐证/);
});

test('有工具的群聊与联络 Agent 在两种协议下都只获得一次框架导航', () => {
  for (const native of [false, true]) {
    const room = buildSeatRoomSystemPrompt({
      dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a', seat, agent,
      toolDefs, native, wsRelPath: 'data/cyclone/workshop-a/workspace', topic: '评审',
    });
    const contact = buildSeatContactSystemPrompt({
      dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a', seat, agent,
      toolDefs, native, wsRelPath: 'data/cyclone/workshop-a/workspace', fromTitle: '后端',
    });
    assert.equal(room.match(/## 4torm 框架导航/g)?.length, 1);
    assert.equal(contact.match(/## 4torm 框架导航/g)?.length, 1);
  }
});

test('没有工具的群聊与联络副本不宣称可访问框架导航', () => {
  const room = buildSeatRoomSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a', seat, agent,
    toolDefs: [], native: true, wsRelPath: 'data/cyclone/workshop-a/workspace', topic: '评审',
  });
  const contact = buildSeatContactSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a', seat, agent,
    toolDefs: [], native: true, wsRelPath: 'data/cyclone/workshop-a/workspace', fromTitle: '后端',
  });
  assert.doesNotMatch(room, /## 4torm 框架导航/);
  assert.doesNotMatch(room, /多步骤执行优先交给固定工位/);
  assert.doesNotMatch(contact, /## 4torm 框架导航/);
});
