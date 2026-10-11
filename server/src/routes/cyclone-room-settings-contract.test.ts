import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync('src/modules/cyclone/application/room-service.ts', 'utf8');
const methods = fs.readFileSync('src/modules/cyclone/api/room-methods.ts', 'utf8');

test('群聊设置冲突统一映射为中心可识别的 conflict', () => {
  assert.match(service, /RoomSettingsConflictError/);
  assert.match(service, /CYCLONE_ROOM_BUSY/);
  assert.match(service, /'conflict'/);
});

test('成员、顺序、名称、话题与模式修改都经过设置锁', () => {
  for (const mutation of ['joinRoom', 'leaveRoom', 'setRoomParticipants', 'renameRoom', 'setRoomTopic', 'setRoomMode']) {
    assert.match(service, new RegExp(`this\\.settings[\\s\\S]{0,180}${mutation}\\(`));
  }
});

test('群聊话题提供正式设置端点', () => {
  assert.match(methods, /setRoomTopic/);
  assert.match(methods, /rooms\.topic/);
});
