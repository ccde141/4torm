import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('入会摘要通过群聊流注册表启动', () => {
  const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');
  const runners = fs.readFileSync('src/cyclone/ui/pages/useRoomStreamRunners.ts', 'utf8');
  assert.match(page, /roomRunners\.startIntro\(activeWid, rm\.id, cfg\.intros\)/);
  assert.match(runners, /room\/\$\{roomId\}\/intro/);
});

test('工位私聊订阅外部 contact 与入会摘要活动', () => {
  const seat = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  assert.match(seat, /useSeatExternalActivity\(workshopId, seatId, !isChair\)/);
  assert.match(seat, /externalRunning/);
});
