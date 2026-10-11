import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/cyclone-room-routes.ts', 'utf8');
const chairRoute = fs.readFileSync('src/routes/cyclone-chair-routes.ts', 'utf8');
const seatRoute = fs.readFileSync('src/routes/cyclone-seat-routes.ts', 'utf8');

test('人类 SSE 与 Agent 后台轮次共用气旋房间运行端口', () => {
  assert.match(route, /router\.prepareTransport\('cyclone', 'roomRound'/);
  assert.doesNotMatch(route, /speakInRoom/);
});

test('入会介绍由气旋内部端口完整管理而不是在 HTTP 路由拼装', () => {
  assert.match(route, /router\.prepareTransport\('cyclone', 'roomIntroduction'/);
  assert.doesNotMatch(route, /generateJoinSpeech|tryAcquireSeatLock|beginCycloneExecution/);
});

test('会长对话由气旋内部端口管理完整执行生命周期', () => {
  assert.match(chairRoute, /router\.prepareTransport\('cyclone', 'chairChat'/);
  assert.doesNotMatch(chairRoute, /chatChairWithinExecution|beginCycloneExecution|loadWorkshop/);
});

test('工位私聊与恢复由气旋内部端口管理完整执行生命周期', () => {
  assert.match(seatRoute, /router\.prepareTransport\('cyclone', 'seatChat'/);
  assert.doesNotMatch(seatRoute, /chatSeatWithinExecution|resumeSeatWithinExecution/);
});

test('工位上下文压缩由气旋内部端口持有计划与提交过程', () => {
  assert.match(seatRoute, /router\.prepareTransport\('cyclone', 'seatCompaction'/);
  assert.doesNotMatch(seatRoute, /planSeatCompaction|applySeatCompaction|beginCycloneExecution/);
});
