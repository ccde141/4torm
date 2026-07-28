import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/cyclone.ts', 'utf8');

test('群聊设置冲突统一映射为 409', () => {
  assert.match(route, /RoomSettingsConflictError/);
  assert.match(route, /runRoomSettingsMutation/);
  assert.match(route, /reply\.status\(409\)/);
});

test('成员、顺序、名称、话题与模式修改都经过设置锁', () => {
  for (const mutation of ['joinRoom', 'leaveRoom', 'setRoomParticipants', 'renameRoom', 'setRoomTopic', 'setRoomMode']) {
    assert.match(route, new RegExp(`runRoomSettingsMutation[\\s\\S]{0,180}${mutation}\\(`));
  }
});

test('群聊话题提供正式设置端点', () => {
  assert.match(route, /action === 'set-topic'/);
  assert.match(route, /setRoomTopic/);
});
