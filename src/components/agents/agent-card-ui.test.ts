import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveMessage } from '../../i18n/locale.js';
import type { Agent } from '../../types/index.js';
import { activitySummaryKey, cardDetails, recordTitle, workspaceDisplayLabel } from './agent-card-view.js';

const agent: Agent = {
  id: 'agent-test', name: '研究员', role: '分析', status: 'idle',
  model: 'provider:deepseek-v4-flash', description: '负责架构审查',
  config: { workspace: 'data/agents/agent-test/.workspace/' },
  createdAt: '', updatedAt: '', tasksCompleted: 0,
  workspaceDisplayPath: './data/agents/agent-test/.workspace',
};

test('整张卡片是唯一操作入口，并以真实配置和活动为内容', () => {
  const details = cardDetails(agent, { kind: 'idle', label: '空闲',
    summary: '当前未观察到执行中的事项', source: 'Agent 活动状态',
    events: [], complete: true });
  assert.deepEqual(details, {
    model: 'deepseek-v4-flash', workspace: './data/agents/agent-test/.workspace', recent: undefined,
    feature: undefined });
  const source = readFileSync('src/components/agents/AgentCard.tsx', 'utf8');
  assert.doesNotMatch(source, /↗|查看执行情况|agent-card__chevron/);
  assert.doesNotMatch(source, /agent-card__description/);
  assert.doesNotMatch(source, /dashboard.card.defaultWorkspace/);
  const styles = readFileSync('src/styles/components/agent-card.css', 'utf8');
  assert.match(styles, /\.agent-card\s*\{[^}]*min-height:\s*266px/);
  assert.match(source, /cardDetails\(agent, activity\)/);
  assert.match(source, /agent-card__meta/);
  assert.match(source, /workspaceDisplayLabel\(details\.workspace\)/);
  assert.match(source, /t\('agent\.model'\)/);
  assert.match(source, /t\('agent\.workspace'\)/);
  const detailStyles = readFileSync('src/styles/components/agent-detail.css', 'utf8');
  assert.match(detailStyles, /\.agent-detail__source-card[^}]*overflow-wrap:\s*anywhere/);
  assert.match(source, /<button[\s\S]*?<\/button>/);
});

test('旧数据缺少展示路径时，仍展示其真实配置而非“默认”字样', () => {
  const oldAgent = { ...agent, workspaceDisplayPath: undefined };
  const details = cardDetails(oldAgent, { kind: 'idle', label: '空闲',
    summary: '当前未观察到执行中的事项', source: 'Agent 活动状态',
    events: [], complete: true });
  assert.equal(details.workspace, 'data/agents/agent-test/.workspace/');
  assert.equal(workspaceDisplayLabel(details.workspace), './data/agents/agent-test/.workspace/');
});

test('记录标题不把气旋工位机器 ID 当成可读名称', () => {
  assert.equal(recordTitle({ operationId: 'seat:workshop-a:seat-mu123',
    title: 'seat-mu123' }), undefined);
  assert.equal(recordTitle({ operationId: 'seat:workshop-a:seat-mu123',
    title: '通用助手A' }), '通用助手A');
});

test('外部工作区保留绝对路径以便定位', () => {
  const external = { ...agent, workspaceDisplayPath: 'D:/research' };
  const details = cardDetails(external, { kind: 'idle', label: '空闲',
    summary: '当前未观察到执行中的事项', source: 'Agent 活动状态' });
  assert.equal(details.workspace, 'D:/research');
  assert.equal(workspaceDisplayLabel(details.workspace), 'D:/research');
  assert.equal(workspaceDisplayLabel('./data/agents/agent-test/.workspace'),
    './data/agents/agent-test/.workspace');
});

test('详情章节标题按界面语言切换', () => {
  assert.equal(resolveMessage('zh-CN', 'dashboard.detail.currentState'), '当前状态');
  assert.equal(resolveMessage('en-US', 'dashboard.detail.currentState'), 'Current state');
  assert.equal(resolveMessage('zh-CN', 'dashboard.detail.factsRecords'), '事实与记录');
  assert.equal(resolveMessage('en-US', 'dashboard.detail.factsRecords'), 'Facts & records');
  assert.equal(resolveMessage('en-US', 'dashboard.detail.config'), 'Agent config');
  assert.equal(resolveMessage('en-US', 'dashboard.detail.memory'), 'Memory');
});

test('探针把 ID 当标题时，卡片不把机器 ID 当作人类摘要', () => {
  const details = cardDetails(agent, { kind: 'idle', label: '空闲',
    summary: '当前未观察到执行中的事项', source: 'Agent 活动状态',
    events: [], complete: true,
    recentFeature: 'monsoon', recent: { operationId: 'session-1',
      title: 'session-1', status: 'completed' } });
  assert.deepEqual(details.recent, {
    title: undefined, status: 'completed', feature: 'monsoon',
  });
});

test('无事项时的状态摘要可本地化，记录标题不暴露机器 ID', () => {
  const idle = { kind: 'idle' as const, label: '空闲',
    summary: '当前未观察到执行中的事项', source: 'Agent 活动状态',
    events: [], complete: true };
  assert.equal(activitySummaryKey(idle), 'dashboard.summary.idle');
  assert.equal(activitySummaryKey({ ...idle, summary: '用户自定义的真实状态' }), undefined);
  assert.equal(resolveMessage('en-US', activitySummaryKey(idle)!),
    'No active operation observed');
  assert.equal(recordTitle({ title: 'operation-1', operationId: 'operation-1',
    runId: 'run-1' }), undefined);
});

test('详情收起期间由同一张卡片接续内容，直到形变结束才交还原卡片', () => {
  const dialog = readFileSync('src/components/agents/AgentDetailDialog.tsx', 'utf8');
  const styles = readFileSync('src/styles/components/agent-detail.css', 'utf8');
  assert.match(dialog, /agent-detail__card-preview[\s\S]*?<AgentCard/);
  assert.match(dialog, /onTransitionEnd=/);
  assert.match(dialog, /closeRef\.current\(\);\s*requestAnimationFrame/);
  assert.match(styles, /agent-detail--closing \.agent-detail__card-preview\s*\{\s*opacity:\s*1/);
  assert.match(styles, /agent-detail--closing::before\s*\{\s*opacity:\s*0/);
});
