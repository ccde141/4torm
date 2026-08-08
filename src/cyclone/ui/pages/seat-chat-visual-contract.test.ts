import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('气旋工位使用气旋自己的轻量工具活动卡', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/CycloneBlockRows.tsx', 'utf8');
  const blockRows = source.slice(source.indexOf('export function BlockRows'));

  assert.ok(blockRows, '应存在独立的 BlockRows 渲染入口');
  assert.match(blockRows, /CycloneToolActivityList/);
  assert.doesNotMatch(blockRows, /<ToolActivityList/);
  assert.match(blockRows, /<BlockRow/);
});

test('气旋群聊把一名 Agent 的工具和正文收进同一个回合气泡', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/RoomFeedRow.tsx', 'utf8');

  assert.match(source, /cyclone-room-turn/);
  assert.match(source, /cyclone-room-turn__bubble/);
  assert.match(source, /CycloneTurnWorklog/);
  assert.doesNotMatch(source, /ToolCallMessage/);
});

test('气旋群聊保留真实分段顺序但不为每个分段创建独立回复气泡', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/RoomFeedRow.tsx', 'utf8');

  assert.match(source, /splitTurnSegments/);
  assert.match(source, /workSegments/);
  assert.match(source, /finalContent/);
  assert.doesNotMatch(source, /<AssistantBubble/);
  assert.doesNotMatch(source, /conv__speaker-label--offset/);
});

test('气旋群聊收到 dispatch-created 时立即刷新派发卡片', () => {
  const runners = fs.readFileSync('src/cyclone/ui/pages/useRoomStreamRunners.ts', 'utf8');
  const page = fs.readFileSync('src/cyclone/ui/pages/CyclonePage.tsx', 'utf8');

  assert.match(runners, /onDispatchCreated/);
  assert.match(runners, /ev\.type === 'dispatch-created'/);
  assert.match(page, /useRoomStreamRunners[\s\S]*?refreshDispatches/);
});

test('气旋工位自由输入会接续挂起的 Ask，而不是开启新会话轮次', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  const start = source.indexOf('function dispatchText');
  const end = source.indexOf('dispatchTextRef.current', start);
  const dispatchText = start >= 0 && end > start ? source.slice(start, end) : '';

  assert.match(dispatchText, /run\(pending \? 'resume' : 'chat', text\)/);
});

test('Ask 接续时隐藏旧的未回答卡，只保留历史中的单一卡片', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');

  assert.match(source, /pending && !runner && !hasUnansweredAsk\(visibleHistory\) && \(/);
});

test('气旋工位把历史和实时回复投影到同一个回合组件', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');

  assert.match(source, /projectSeatTimeline\(visibleHistory\)/);
  assert.match(source, /createLiveSeatTurn\(live\.segments, live\.reasoning\)/);
  assert.match(source, /<SeatTurnCard/);
  assert.doesNotMatch(source, /<LiveReplySegments/);
});

test('气旋工位回合用一个气泡承载工作过程和最终回答', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatTurnCard.tsx', 'utf8');

  assert.match(source, /cyclone-seat-turn__bubble/);
  assert.match(source, /SeatTurnWorklog/);
  assert.match(source, /turn\.finalContent/);
  assert.match(source, /turn\.actionMessage/);
  assert.match(source, /streaming \|\| blocks\.some/);
  assert.match(source, /aria-label="编辑最终回复"/);
  assert.match(source, /aria-label="删除最终回复"/);
  assert.doesNotMatch(source, /!msg\.content && actions/);
});

test('气旋系统工具使用本地语义气泡，普通工具仍走普通工具卡', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/CycloneBlockRows.tsx', 'utf8');

  assert.match(source, /isCycloneSystemTool/);
  assert.match(source, /<CycloneSystemToolCard/);
  assert.match(source, /<ToolCallMessage/);
  assert.doesNotMatch(source, /components\/chat\/MessageItem/);
});

test('工位 dispatch 状态优先关联原调用卡，仅为孤儿追加尾卡', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');

  assert.match(source, /orphanedDispatches\.map\(item => <SeatOutboundDispatch/);
  assert.match(source, /<SeatTurnCard turn=\{createLiveSeatTurn[\s\S]*dispatches=\{dispatches\}/);
});

test('历史 Ask 在统一回合内继续使用真实 resume 回调', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');

  assert.match(source, /<SeatTurnCard key=\{item\.turn\.id\}[\s\S]*onAskReply=\{answer => run\('resume', answer\)\}/);
});
