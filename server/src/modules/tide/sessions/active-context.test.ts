import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTideContext } from './active-context.js';

test('Tide active context uses the latest exact compaction marker and retains new records', () => {
  const context = activeTideContext([
    { id: 'one', role: 'user', content: '应归档的旧内容' },
    { id: 'two', role: 'system', content: '摘要', type: 'compact-marker',
      nativeContext: [{ role: 'system', content: '准确摘要' }, { role: 'user', content: '最近任务' }] },
    { id: 'three', role: 'assistant', content: '新回复' },
  ]);
  assert.deepEqual(context.map(message => message.content), ['准确摘要', '最近任务', '新回复']);
});

test('Tide tool execution evidence survives projection rather than silently disappearing', () => {
  const context = activeTideContext([{ id: 'tool', role: 'tool-result',
    content: JSON.stringify({ tool: 'read_file', result: '证据', ok: true }) }]);
  assert.match(context[0].content, /证据/);
  assert.match(context[0].content, /tool-result/);
});

test('Tide restores exact compressed history without merging summary into static instructions or changing originals', () => {
  const identity = { role: 'system' as const, content: 'Static role and permissions' };
  const raw = [{ id: 'old', role: 'user', content: 'Archived raw history' },
    { id: 'marker', role: 'system', content: 'Summary', type: 'compact-marker' as const,
      contextExact: true, nativeContext: [{ role: 'system' as const, content: 'Summary' },
        { role: 'assistant' as const, content: 'Recent completed result' }] },
    { id: 'new', role: 'user', content: 'Next human request' }];
  assert.deepEqual([identity, ...activeTideContext(raw)], [identity,
    { role: 'system', content: 'Summary' }, { role: 'assistant', content: 'Recent completed result' },
    { role: 'user', content: 'Next human request' }]);
  assert.equal(raw[0].content, 'Archived raw history');
});
