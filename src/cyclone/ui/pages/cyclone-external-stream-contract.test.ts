import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('入会摘要通过群聊流注册表启动', () => {
  const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');
  const runners = fs.readFileSync('src/cyclone/ui/pages/useRoomStreamRunners.ts', 'utf8');
  assert.match(page, /roomRunners\.startIntro\(activeWid, room\.id, config\.intros\)/);
  assert.match(runners, /room\/\$\{roomId\}\/intro/);
});

test('工位私聊订阅外部 contact 与入会摘要活动', () => {
  const seat = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  assert.match(seat, /useSeatExternalActivity\(workshopId, seatId, active && !isChair\)/);
  assert.match(seat, /externalRunning/);
});

test('工位与群聊流注册表 API 在父组件重渲染时保持引用稳定', () => {
  for (const file of ['useSeatStreamRunners.ts', 'useRoomStreamRunners.ts']) {
    const source = fs.readFileSync(`src/cyclone/ui/pages/${file}`, 'utf8');
    assert.match(source, /return useMemo\(\(\) => \(\{/);
  }
});
