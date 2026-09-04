import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panel = fs.readFileSync('src/cyclone/ui/pages/RoomSettingsPanel.tsx', 'utf8');
const room = fs.readFileSync('src/cyclone/ui/pages/RoomPanel.tsx', 'utf8');
const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');

test('群聊使用正式会议设置入口而非常驻在场配置栏', () => {
  assert.match(room, /RoomSettingsPanel/);
  assert.doesNotMatch(room, /RoomConfigBar/);
  assert.match(panel, /cyclone\.settings\.title/);
  assert.match(panel, /cyclone\.settings\.leave/);
});

test('会议设置覆盖元信息、模式、顺序与邀请方式', () => {
  assert.match(panel, /set-topic/);
  assert.match(panel, /set-mode/);
  assert.match(panel, /reorder/);
  assert.match(panel, /cyclone\.room\.behaviorSummary/);
  assert.match(panel, /cyclone\.room\.behaviorIntro/);
  assert.match(panel, /cyclone\.room\.behaviorNone/);
});

test('会议运行期间设置入口与写操作都被锁定', () => {
  assert.match(room, /settingsLocked/);
  assert.match(panel, /locked/);
  assert.match(panel, /disabled=\{locked/);
  assert.match(page, /subscribeSeat\(chairStreamKey\(activeRoomId\)/);
});
