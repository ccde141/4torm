import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panel = fs.readFileSync('src/cyclone/ui/pages/RoomSettingsPanel.tsx', 'utf8');
const room = fs.readFileSync('src/cyclone/ui/pages/RoomPanel.tsx', 'utf8');
const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');

test('群聊使用正式会议设置入口而非常驻在场配置栏', () => {
  assert.match(room, /RoomSettingsPanel/);
  assert.doesNotMatch(room, /RoomConfigBar/);
  assert.match(panel, /会议设置/);
  assert.match(panel, /请离会议/);
});

test('会议设置覆盖元信息、模式、顺序与邀请方式', () => {
  assert.match(panel, /set-topic/);
  assert.match(panel, /set-mode/);
  assert.match(panel, /reorder/);
  assert.match(panel, /工作摘要/);
  assert.match(panel, /自我介绍/);
  assert.match(panel, /静默入会/);
});

test('会议运行期间设置入口与写操作都被锁定', () => {
  assert.match(room, /settingsLocked/);
  assert.match(panel, /locked/);
  assert.match(panel, /disabled=\{locked/);
  assert.match(page, /seatRunners\.subscribe\(chairStreamKey\(activeRoomId\)/);
});
