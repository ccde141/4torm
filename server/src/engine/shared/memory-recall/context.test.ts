import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateRecallCandidates, recentRecallConversation, recallMessageText } from './context.js';
import { reusableRecallPending } from './pending.js';
import { searchRecall } from './retrieval.js';
import type { ContextMessage } from '../types.js';
import type { RecallDocument, RecallPending, RecallSources } from './contracts.js';

test('the helper sees the opening task and recent corrections, without treating tool text or recalled tasks as human direction', () => {
  const messages: ContextMessage[] = [{ role: 'user', origin: 'human', content: '当前给角色甲打标。' },
    { role: 'user', origin: 'framework', content: '旧记录要求继续角色乙的工作' },
    ...Array.from({ length: 8 }, (_, i): ContextMessage => ({ role: 'assistant', content: `处理第${i}张` })),
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'read_image', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c', content: '工具文字不应冒充人类要求' },
    { role: 'user', origin: 'human', content: '旧说明。'.repeat(1000) + '最后更正：角色甲的触发词改成甲二。' },
    { role: 'assistant', content: '已改正' }, { role: 'user', origin: 'human', content: '这张继续' }];
  const recent = recentRecallConversation(messages);
  assert.equal(recent[0].content, '当前给角色甲打标。');
  assert.ok(recent.some(item => item.content.endsWith('最后更正：角色甲的触发词改成甲二。')));
  assert.ok(!JSON.stringify(recent).includes('旧记录要求') && !JSON.stringify(recent).includes('工具文字'));
  assert.ok(!recent.some(item => item.content === '这张继续'));
  const compacted = recentRecallConversation([{ role: 'system', content: '[历史压缩记录]\n当前工作为角色甲打标。' },
    { role: 'user', origin: 'human', content: '继续检查这张图' }]);
  assert.match(compacted[0].content, /角色甲/); assert.equal(compacted[0].role, 'assistant');
  const longInput = recallMessageText('这次给角色甲打标。' + '附带旧资料。'.repeat(1000) + '最后更正：不要套用角色乙。');
  assert.ok(longInput.length <= 4000 && longInput.startsWith('这次给角色甲打标。') && longInput.endsWith('最后更正：不要套用角色乙。'));
});

test('candidate previews locate a matching passage beyond the beginning and retain exact source offsets', async () => {
  const document: RecallDocument = { id: 'memory:tags', kind: 'memory', agentId: 'a', title: '打标方法', summary: '方法',
    content: '角色乙的历史经过。'.repeat(200) + '\n\n角色甲打标：固定标签与逐图标签分开。', revision: 'v1', timestamp: '2026-11-03' };
  const sources: RecallSources = { sync: async () => {}, list: async () => [document], read: async () => document };
  const [candidate] = await hydrateRecallCandidates('a', sources, [document], new AbortController().signal, '角色甲打标');
  assert.ok(candidate.excerptOffset! > 1000); assert.match(candidate.excerpt!, /角色甲/);
  assert.equal(document.content.slice(candidate.excerptOffset, candidate.excerptOffset! + candidate.excerpt!.length), candidate.excerpt);
});

test('zero-match records do not fill a candidate list, while explicit session browsing remains available', async () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ id: `work:${i}`, kind: 'work' as const, agentId: 'a',
    title: '发票归档', summary: '财务报告', sessionId: 'old', revision: 'v1', timestamp: '2026-11-03' }));
  const sources: RecallSources = { sync: async () => {}, list: async () => records, read: async () => null };
  assert.deepEqual((await searchRecall('unused', 'a', sources, { query: '角色甲图片打标', limit: 20 }, { candidates: true })).records, []);
  assert.equal((await searchRecall('unused', 'a', sources, { query: '浏览', sessionId: 'old' }, { candidates: true })).records.length, 12);
});

test('a new task or a rejected prepared memory is not revived merely by continuation wording', () => {
  const pending: RecallPending = { id: 'work:old', revision: 'v1', kind: 'work', level: 'L2', title: '角色乙打标',
    text: '角色乙有鱼尾。', status: 'ready', preparedFor: 'old', preparedAt: '2026-11-03',
    context: [{ role: 'user', content: '角色乙打标' }] };
  assert.deepEqual(reusableRecallPending('有个新任务，继续给角色甲打标', [], [pending]), []);
  assert.deepEqual(reusableRecallPending('继续', [], [{ ...pending, status: 'shelved' }]), []);
  assert.equal(reusableRecallPending('继续', [], [pending]).length, 1);
  assert.deepEqual(reusableRecallPending('角色甲打标', [], [pending]), []);
  assert.equal(reusableRecallPending('继续检查角色乙打标', [], [pending]).length, 1);
});
