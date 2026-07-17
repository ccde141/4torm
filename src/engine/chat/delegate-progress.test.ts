import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDelegateProgressAtToolBoundary, visibleDelegateProgress } from './delegate-progress';

test('纯空白工具轮不会累积空行', () => {
  let content = '';
  content = normalizeDelegateProgressAtToolBoundary(content + '\n\n');
  content = normalizeDelegateProgressAtToolBoundary(content + '\n');
  assert.equal(content, '');
  assert.equal(visibleDelegateProgress(content), '');
});

test('工具边界保留文字与内部段落但不累积尾部空白', () => {
  let content = '先检查结构。\n\n';
  content = normalizeDelegateProgressAtToolBoundary(content);
  content = normalizeDelegateProgressAtToolBoundary(content + '\n\n');
  content += '继续读取文档。\n\n';
  assert.equal(visibleDelegateProgress(content), '先检查结构。\n继续读取文档。');
});
