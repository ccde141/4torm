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
  assert.match(seat, /useSeatExternalActivity\(workshopId, seatId, active && !isChair && !isSupervisor\)/);
  assert.match(seat, /externalRunning/);
});

test('主管沿独立工作室身份复用私聊呈现，不读取虚构工位活动', () => {
  const seat = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  const panel = fs.readFileSync('src/cyclone/ui/pages/SupervisorPanel.tsx', 'utf8');
  const runners = fs.readFileSync('src/cyclone/ui/pages/useSupervisorStreamRunners.ts', 'utf8');
  assert.match(seat, /isSupervisor \? 'supervisor' : isChair \? 'chair' : 'seat'/);
  assert.match(panel, /<SeatChat[\s\S]*seatId=\{SUPERVISOR_STREAM_KEY\}/);
  assert.match(runners, /useSeatStreamRunners\(finished, locale, workshopId \?\? ''\)/);
});

test('主管任务板随统一会话收尾重读且隔离过期工作室响应，不新增轮询源', () => {
  const seat = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  const reload = seat.slice(seat.indexOf('const reload = useCallback'), seat.indexOf('const contextOperation ='));
  assert.match(reload, /isSupervisor \? await loadSupervisorTaskboard\(workshopId\)/);
  assert.match(reload, /loadSupervisorTaskboard\(workshopId\)[\s\S]*seq !== reloadSeq\.current[\s\S]*reconcileSupervisorTaskboard/);
  assert.match(seat, /if \(boardScope\.current !== scope\) return/);
  assert.match(seat, /clearAgentActivity\(runId\)/);
  assert.match(seat, /await reload\(true\);[\s\S]*runners\.clearIfDone/);
});

test('Agent 外部工位和会议助理私聊接入已打开的私聊页', () => {
  const seat = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  const hook = fs.readFileSync('src/cyclone/ui/pages/usePrivateChatActivity.ts', 'utf8');
  const chair = fs.readFileSync('src/cyclone/ui/pages/ChairDrawer.tsx', 'utf8');
  assert.match(seat, /usePrivateChatActivity\(/);
  assert.match(seat, /projectPrivateChatLive\(/);
  assert.match(hook, /'readPrivateChatActivity'/);
  assert.match(hook, /nextActivityCursor\(payload\)/);
  assert.match(chair, /active=\{open\}/);
});

test('工位与群聊流注册表 API 在父组件重渲染时保持引用稳定', () => {
  for (const file of ['useSeatStreamRunners.ts', 'useRoomStreamRunners.ts']) {
    const source = fs.readFileSync(`src/cyclone/ui/pages/${file}`, 'utf8');
    assert.match(source, /return useMemo\(\(\) => \(\{/);
  }
});
