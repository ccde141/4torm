import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildFrameworkAwarenessSection } from './framework-awareness.js';
import { buildSubAgentMeta } from './meta-prompt.js';
import type { LoadedAgent } from './agent-loader.js';
import { buildConversationSystemPrompt, type PromptBuildOpts } from '../conversation/prompt-builder.js';
import { MAIN_ADVANCED_CAPABILITIES } from '../conversation/main-guidance.js';
import { buildChairPrompt, buildSeatContactSystemPrompt, buildSeatRoomSystemPrompt,
  buildSeatSystemPrompt } from '../cyclone/seat-prompt.js';
import { buildSupervisorPrompt } from '../cyclone/supervisor-prompt.js';
import type { SupervisorData } from '../cyclone/supervisor-store.js';
import type { RoomData, SeatData, WorkshopData } from '../cyclone/types.js';
import { buildTradewindSystemPrompt } from '../tradewind/execution/prompt-builder.js';
import { buildMeetingAgentPrompt, buildMeetingChairSystem, buildOpeningPromptNoHistory,
  buildOpeningPromptWithHistory } from '../tradewind/execution/meeting-handlers.js';
import { createMeetingSession } from '../tradewind/execution/meeting-session.js';
import { buildTradewindMinutesMeta } from '../tradewind/execution/meta-profiles.js';

const agent: LoadedAgent = {
  id: 'agent-a', name: '分析员', model: 'provider:model', rolePrompt: 'ROLE-MARKER',
  temperature: 0.7, tools: [], toolMode: 'selected', skills: [], workspace: 'workspace',
  sandboxLevel: 'project',
};
const seat: SeatData = {
  id: 'seat-a', title: '研究工位', rolePrompt: '', agentId: agent.id,
  messages: [], createdAt: '', updatedAt: '',
};
const workshop: WorkshopData = {
  id: 'workshop-a', title: '研究项目', seatIds: [], roomIds: [], createdAt: '', updatedAt: '',
};
const room: RoomData = {
  id: 'room-a', title: '评审会', topic: '研究计划', participantSeatIds: [],
  publicMessages: [], createdAt: '', updatedAt: '',
};
const tools = [{ name: 'read_file', description: '读取文件', parameters: { type: 'object' } }];

function assertAwareness(prompt: string): void {
  assert.equal(prompt.split('## 4torm 功能区认知').length - 1, 1);
  assert.ok(prompt.includes(buildFrameworkAwarenessSection()));
  assert.match(prompt, /以上概念说明不授予额外能力/);
}

function assertNoExecutionGuide(prompt: string): void {
  assert.doesNotMatch(prompt, /## 4torm 框架导航|## 能力扩展|## 可用工具|JSON 调用信封|"type":"tool_call"|docs\//);
}

async function isolated(run: (root: string) => Promise<void> | void): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'framework-awareness-'));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function conversationOptions(root: string, native: boolean): PromptBuildOpts {
  return {
    rolePrompt: agent.rolePrompt, toolDefs: tools, workspace: 'workspace', workspaceAbs: root,
    projectDir: root, sandboxLevel: 'project', skillIds: [], dataDir: root,
    agentId: agent.id, native, allowAsk: false, allowDelegate: false,
  };
}

test('功能区认知描述工作形式与身份，不注入工具或文件访问协议', () => {
  const prompt = buildFrameworkAwarenessSection();
  assertAwareness(prompt);
  assertNoExecutionGuide(prompt);
  for (const area of ['季风', '对流', '信风', '气旋', '潮汐']) assert.ok(prompt.includes(area));
  assert.match(prompt, /严格依赖模式.*条件交接模式/s);
  assert.match(prompt, /同一个池中 Agent.*不代表.*共用一段会话/s);
  assert.match(prompt, /更换绑定 Agent 不会清空工位已有资料/);
  assert.match(prompt, /任务板、记忆.*不能替代真实运行状态/s);
});

test('季风主会话两种工具协议恰好注入一次认知，保留角色与实际能力限制', async () => {
  await isolated(async root => {
    for (const native of [false, true]) {
      const prompt = await buildConversationSystemPrompt({
        ...conversationOptions(root, native), mainAgent: true, sessionId: 'session-a',
      });
      assert.equal(prompt.split('## 高级功能区与使用时机').length - 1, 1);
      assert.ok(prompt.includes(MAIN_ADVANCED_CAPABILITIES));
      assert.ok(!prompt.includes(buildFrameworkAwarenessSection()));
      assert.match(prompt, /你.*季风/);
      assert.match(prompt, /本次运行提供的定义为准/);
      assert.ok(prompt.endsWith('ROLE-MARKER'));
      assert.doesNotMatch(prompt, /### 信风工作流|### 气旋工作室|### 潮汐自动任务/);
      if (native) assert.doesNotMatch(prompt, /"type":"tool_call"/);
    }
  });
});

test('受限工作队保留本轮委托与受限能力身份', async () => {
  await isolated(async root => {
    for (const native of [false, true]) {
      const member = await buildConversationSystemPrompt({
        ...conversationOptions(root, native), providedToolsOnly: true,
        surfaceMeta: '你是季风当前会话工作队中的成员，只执行主 Agent 本轮委托。',
      });
      assertAwareness(member);
      assert.match(member, /只执行主 Agent 本轮委托/);
      assert.doesNotMatch(member, /## 4torm 框架导航|## 能力扩展|### ask\n|### delegate\n/);
    }
  });
});

test('气旋三类工位场景和主管两种协议各自恰好获得一次认知', async () => {
  await isolated(async dataDir => {
    const supervisor: SupervisorData = {
      id: 'supervisor', title: '主管', agentId: agent.id, rolePrompt: '', messages: [],
      revision: 0, memory: [], memoryRevision: 0, createdAt: '', updatedAt: '',
    };
    for (const native of [false, true]) {
      const opts = { dataDir, workshopId: workshop.id, seat, agent, toolDefs: tools,
        native, wsRelPath: 'workspace' };
      const solo = buildSeatSystemPrompt(opts);
      const group = buildSeatRoomSystemPrompt({ ...opts, topic: room.topic });
      const contact = buildSeatContactSystemPrompt({ ...opts, fromTitle: '核验工位' });
      const manager = buildSupervisorPrompt(dataDir, workshop.id, supervisor, agent, tools, native);
      for (const prompt of [solo, group, contact, manager]) assertAwareness(prompt);
      assert.match(solo, /正在与人类一对一私聊/);
      assert.match(group, /群聊中的临时参与副本/);
      assert.match(contact, /此刻没有人类在场/);
      assert.match(manager, /不是工位，也不属于某个协作组/);
      assert.match(manager, /不能跨工作室管理/);
    }
    const assistant = (await buildChairPrompt(dataDir, workshop.id, room, workshop, agent)).systemMessage.content;
    assertAwareness(assistant);
    assertNoExecutionGuide(assistant);
    assert.match(assistant, /你没有任何工具，也不能直接指挥工位干活/);
  });
});

test('信风节点、会议、助理与纪要身份不因认知段获得额外执行权限', async () => {
  await isolated(dataDir => {
    const session = createMeetingSession({ nodeId: 'meeting-a', meetingLabel: room.title,
      chairAgentId: agent.id, participants: [], topic: room.topic });
    for (const native of [false, true]) {
      const node = buildTradewindSystemPrompt({
        rolePrompt: agent.rolePrompt, toolDefs: tools, notes: [], nodeLabel: '研究节点',
        teamRoster: [], workspace: 'workspace', workspaceAbs: dataDir, projectDir: dataDir,
        sandboxLevel: 'project', allowDelegate: false, agentName: agent.name,
        executionId: 'execution-a', nodeId: 'node-a', workflowId: 'workflow-a',
        platform: process.platform, today: '2026-10-28', modelId: agent.model, native,
      });
      assertAwareness(node);
      assert.match(node, /不擅自改变工作流结构、节点分工或信封目标/);
      const meeting = buildMeetingAgentPrompt(agent, [], session, tools, 'workspace',
        '研究节点', room.title, dataDir, [], native);
      assertAwareness(meeting);
      assert.match(meeting, /工具调用与结果也会进入公共会议记录/);
    }
    const chair = buildMeetingChairSystem(agent, session).content;
    assertAwareness(chair);
    assertNoExecutionGuide(chair);
    assert.match(chair, /不参与公共讨论，只在私聊中/);
    const minutes = buildTradewindMinutesMeta();
    assertAwareness(minutes);
    assertNoExecutionGuide(minutes);
    assert.match(minutes, /忠实反映会议记录/);
    const opening = buildOpeningPromptNoHistory(agent.name, agent.rolePrompt, '研究节点', session, []);
    const continuation = buildOpeningPromptWithHistory(agent.name, agent.rolePrompt,
      '研究节点', session, [], [{ role: 'assistant', content: '已核实资料' }]);
    for (const prompt of [opening, continuation]) assertAwareness(prompt);
  });
});

test('SubAgent 的功能区认知保留委托边界', () => {
  const subAgent = buildSubAgentMeta('只核验接口定义。');
  assertAwareness(subAgent);
  assert.match(subAgent, /不能调用 delegate 继续递归委托/);
  assert.match(subAgent, /只核验接口定义/);
});
