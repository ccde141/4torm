import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync('src/modules/cyclone/application/room-service.ts', 'utf8');

test('群聊删除由模块服务拒绝公共或会长会话仍在运行的房间', () => {
  assert.match(service, /this\.assertIdle\(workshopId, roomId\)/);
  assert.match(service, /CYCLONE_ROOM_BUSY/);
  assert.doesNotMatch(service, /activeAborts/);
});

test('群聊删除服务区分不存在、冲突与删除成功', () => {
  assert.match(service, /CYCLONE_ROOM_NOT_FOUND/);
  assert.match(service, /RoomDeleteConflictError/);
  assert.match(service, /return \{ ok: true \}/);
});
