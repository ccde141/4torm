import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./CyclonePage.tsx', import.meta.url), 'utf8');

test('气旋页面只协调状态，侧栏与工作区由独立组件承载', () => {
  assert.match(page, /<CycloneSidebar/);
  assert.match(page, /<CycloneWorkspacePane/);
  assert.ok(page.split(/\r?\n/).length <= 300, 'CyclonePage.tsx 应不超过 300 行');
});

test('目标工位可见时确认已经结束的未读派发', () => {
  assert.match(page, /visibleSeatId/);
  assert.match(page, /item\.targetSeatId === visibleSeatId/);
  assert.match(page, /item\.status === 'completed' \|\| item\.status === 'failed'/);
  assert.match(page, /void markSeatRead\(visibleSeatId\)/);
});
