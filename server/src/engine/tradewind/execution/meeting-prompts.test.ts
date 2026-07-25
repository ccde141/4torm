import assert from 'node:assert/strict';
import type { LoadedAgent } from '../../shared/agent-loader';
import { createMeetingSession } from './meeting-session';
import {
  buildMeetingAgentPrompt,
  buildOpeningPromptNoHistory,
  buildOpeningPromptWithHistory,
} from './meeting-handlers';

const agent: LoadedAgent = {
  id: 'agent-a',
  name: '甲',
  model: 'provider:model',
  rolePrompt: '负责分析。',
  temperature: 0.7,
  tools: [],
  toolMode: 'selected',
  skills: [],
  workspace: 'data/x',
  sandboxLevel: 'relaxed',
};
const session = createMeetingSession({
  nodeId: 'meeting-1',
  meetingLabel: '评审会',
  chairAgentId: 'chair',
  participants: [{ nodeId: 'a', agentId: 'agent-a', label: '分析员' }],
  topic: '评审方案',
});
const labels = ['分析员'];

function assertNoLegacyXml(prompt: string): void {
  assert.doesNotMatch(prompt, /<action|<answer|<think|<result/);
}

const opening = buildOpeningPromptNoHistory(agent.name, agent.rolePrompt, '分析员', session, labels);
assert.match(opening, /直接输出自然语言发言/);
assertNoLegacyXml(opening);

const openingWithHistory = buildOpeningPromptWithHistory(
  agent.name,
  agent.rolePrompt,
  '分析员',
  session,
  labels,
  [{ role: 'assistant', content: '已有进展' }],
);
assert.match(openingWithHistory, /直接输出自然语言发言/);
assertNoLegacyXml(openingWithHistory);

const textPrompt = buildMeetingAgentPrompt(
  agent,
  labels,
  session,
  [],
  'data/workspace',
  '分析员',
  '评审会',
  'data',
  [{ label: '执行员', role: '执行' }],
  false,
);
assert.match(textPrompt, /"type":"tool_call","name":"contact"/);
assert.match(textPrompt, /最终自然语言回答会被公开/);
assert.match(textPrompt, /平等的协作者/);
assert.match(textPrompt, /独立判断/);
assert.match(textPrompt, /不以迎合代替讨论/);
assertNoLegacyXml(textPrompt);

const nativePrompt = buildMeetingAgentPrompt(
  agent,
  labels,
  session,
  [],
  'data/workspace',
  '分析员',
  '评审会',
  'data',
  [{ label: '执行员', role: '执行' }],
  true,
);
assert.doesNotMatch(nativePrompt, /"type":"tool_call"/);
assertNoLegacyXml(nativePrompt);

console.log('meeting prompts ok');
