import assert from 'node:assert/strict';
import test from 'node:test';
import { compactionFeedbackEvent, compactionFeedbackMessage, visibleCompactionFeedback } from './compaction-feedback.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import { CompactionHistory } from './CompactionHistory';
import { compactionHistoryContent, isCompactionHistory } from './compaction-history';

test('compaction feedback clears only on the persisted accepted-input fact', () => {
  assert.equal(compactionFeedbackEvent({ type: 'execution-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'round-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'agent-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'usage', usage: { totalTokens: 20 } }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'usage', usage: null }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'input-accepted' }), null);
  assert.equal(compactionFeedbackEvent({ type: 'compaction-notice', message: '切换模型继续压缩' }), '切换模型继续压缩');
});

test('live feedback distinguishes an unaccepted request from acknowledged clearing and reload', () => {
  const stored = { message: '指定压缩模型离线，已切换' };
  assert.equal(visibleCompactionFeedback(undefined, stored), stored.message);
  assert.equal(visibleCompactionFeedback(null, stored), '');
  assert.equal(visibleCompactionFeedback('新的压缩失败', stored), '新的压缩失败');
  assert.equal(compactionFeedbackMessage(null), '');
  assert.equal(compactionFeedbackMessage({ message: 42 }), '');
  assert.equal(compactionFeedbackEvent({ type: 'compaction-notice', message: 42 }), undefined);
});

test('saved compaction history starts as the shared divider without mounting its long body or actions', () => {
  function UnopenedContent(): never { throw new Error('collapsed history mounted its body'); }
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(CompactionHistory, { content: '[历史压缩记录]\nprivate archived content' },
      createElement(UnopenedContent))));
  assert.match(html, /compaction-history__line/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /历史摘要/);
  assert.doesNotMatch(html, /private archived content|compaction-history__body/);
});

test('history detection accepts stored prefixes and legacy resets without matching ordinary discussion', () => {
  for (const prefix of ['[历史压缩记录]\n', '[会议历史摘要]\n', '[对话历史摘要]\n', '[会话归档摘要]\n\n', '[群聊历史摘要]\n',
    '以下是重置前的工位私聊摘要，请作为后续上下文参考：\n\n',
    '以下是重置前的会长私聊摘要，请作为后续会长上下文参考：\n\n',
    '以下是重置前的群聊摘要，请作为后续群聊上下文参考：\n\n',
    '以下是较早工位私聊的滚动压缩摘要，请与后续保留的原始回合共同作为上下文：\n\n']) {
    assert.equal(isCompactionHistory(`${prefix}完整摘要`), true);
    assert.equal(compactionHistoryContent(`${prefix}完整摘要`), '完整摘要');
  }
  assert.equal(isCompactionHistory('请根据摘要继续讨论'), false);
  assert.equal(isCompactionHistory('文档里写着[历史压缩记录]'), false);
});
