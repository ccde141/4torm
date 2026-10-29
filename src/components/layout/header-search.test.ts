import assert from 'node:assert/strict';
import test from 'node:test';
import { projectHeaderSearch, type HeaderSearchSources } from './header-search';
import { resolveMessage } from '../../i18n/locale';

const sources: HeaderSearchSources = {
  agents: [{ id: 'a', name: 'Draft Agent', role: '编辑' }],
  sessions: [{ id: 's', title: 'Draft conversation', agentName: '编辑' }],
  cyclones: [{ id: 'w', title: 'Draft workshop', seatCount: 2, roomCount: 1 }],
  workflows: [{ workflowId: 'f', name: 'Draft workflow', nodeCount: 3 }],
  tasks: [{ id: 't', name: '', prompt: 'Draft report', schedule: 'daily 08:00' }],
  discussions: [{ id: 'd', title: '', topic: 'Draft review' }],
};
test('搜索聚合保留各区真实 ID，去除关键词首尾空格并忽略大小写', () => {
  const results = projectHeaderSearch('  DRAFT ', sources);
  assert.deepEqual(results.map(item => [item.type, item.id]),
    [['agent', 'a'], ['session', 's'], ['cyclone', 'w'], ['tradewind', 'f'], ['tide', 't'], ['convection', 'd']]);
  assert.deepEqual(projectHeaderSearch(' ', sources), []);
});
test('同一份搜索数据在不同语言下生成徽标、兜底标题与数量文本', () => {
  const results = projectHeaderSearch('draft', sources);
  const workshop = results.find(item => item.type === 'cyclone')!;
  assert.equal(resolveMessage('zh-CN', workshop.detail!.key, workshop.detail!.values), '2 工位 · 1 群聊');
  assert.equal(resolveMessage('en-US', workshop.detail!.key, workshop.detail!.values), 'Seats: 2 · Group chats: 1');
  for (const result of results) {
    const badge = resolveMessage('en-US', `header.type.${result.type}`);
    const title = result.label || resolveMessage('en-US', `header.untitled.${result.type}`);
    assert.doesNotMatch(badge + title, /[\u3400-\u9fff]/);
  }
  assert.equal(resolveMessage('en-US', 'header.searchNodeCount', { count: 3 }), 'Nodes: 3');
});
test('异常单项和错误字段不会让其他数据源的搜索崩溃或渲染对象', () => {
  const results = projectHeaderSearch('draft', { ...sources,
    cyclones: [null, [], 1, { id: {}, title: 'Draft' }, { id: 'w', title: 'Draft', seatCount: {} }],
    workflows: { error: 'unavailable' }, tasks: [{ id: 't', prompt: 'Draft', name: {}, schedule: {} }],
  });
  assert.ok(results.some(item => item.type === 'agent'));
  assert.equal(results.find(item => item.type === 'cyclone')?.detail?.values.seats, 0);
  assert.equal(results.find(item => item.type === 'tide')?.sublabel, '');
});
