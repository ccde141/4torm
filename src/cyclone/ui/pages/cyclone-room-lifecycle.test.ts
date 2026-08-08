import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');
const seatRunners = fs.readFileSync('src/cyclone/ui/pages/useSeatStreamRunners.ts', 'utf8');

test('气旋群聊列表提供带确认的删除入口', () => {
  assert.match(page, /async function deleteRoom\(roomId: string, title: string\)/);
  assert.match(page, /删除群聊「\$\{title\}」/);
  assert.match(page, /title="删除群聊"/);
});

test('服务端确认删除后才清理双会话运行态与当前视图', () => {
  const handler = page.slice(page.indexOf('async function deleteRoom('), page.indexOf('/** 创建群聊'));
  const request = handler.indexOf('/room/${roomId}/delete');
  assert.ok(request >= 0);
  assert.ok(handler.indexOf('roomRunners.kill', request) > request);
  assert.ok(handler.indexOf('seatRunners.kill', request) > request);
  assert.match(handler, /chairStreamKey\(roomId\)/);
  assert.match(handler, /setView\(null\)/);
});

test('运行中的公共会话、会议助理私聊或异步派发禁止触发删除', () => {
  assert.match(page, /roomRunners\.getRunner\(rm\.id\)\?\.streaming/);
  assert.match(page, /seatRunners\.getRunner\(chairStreamKey\(rm\.id\)\)\?\.streaming/);
  assert.match(page, /item\.status === 'awaiting_human'/);
  assert.match(page, /disabled=\{running\}/);
});

test('删除会议助理会话时即使没有 runner 也会清理队列与草稿', () => {
  const start = seatRunners.indexOf('const kill = useCallback');
  const block = seatRunners.slice(start, seatRunners.indexOf('/** SeatChat reload', start));
  const earlyReturn = block.indexOf('if (!r) return');
  assert.ok(block.indexOf('queues.current.delete(seatId)') < earlyReturn);
  assert.ok(block.indexOf('drafts.current.delete(seatId)') < earlyReturn);
});
