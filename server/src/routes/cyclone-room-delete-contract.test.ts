import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/cyclone.ts', 'utf8');

test('群聊删除端点拒绝公共或会长会话仍在运行的房间', () => {
  const start = route.indexOf("if (action === 'delete')", route.indexOf('// ── 群聊级'));
  const block = route.slice(start, route.indexOf("if (action === 'join')", start));
  assert.match(block, /activeAborts\.has\(lockKey\)/);
  assert.match(block, /status\(409\)/);
});

test('群聊删除端点区分不存在与删除成功', () => {
  const start = route.indexOf("if (action === 'delete')", route.indexOf('// ── 群聊级'));
  const block = route.slice(start, route.indexOf("if (action === 'join')", start));
  assert.match(block, /status\(404\)/);
  assert.match(block, /deleted/);
});
