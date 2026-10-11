import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const routeFiles = [
  'convection.ts',
  'convection-session-routes.ts',
  'convection-stream-routes.ts',
  'convection-feed-routes.ts',
];

test('对流 HTTP 边界按职责拆分且聚合入口不承载业务端点', () => {
  for (const file of routeFiles) {
    const source = fs.readFileSync(`src/routes/${file}`, 'utf8');
    assert.ok(source.split(/\r?\n/).length <= 300, `${file} exceeds 300 lines`);
  }
  const facade = fs.readFileSync('src/routes/convection.ts', 'utf8');
  assert.doesNotMatch(facade, /app\.(all|get|post|delete|put|patch)\(/);
  assert.doesNotMatch(facade, /engine\/convection/);
});

test('会议订阅经中心端口并在 SSE 关闭时释放监听', () => {
  const source = fs.readFileSync('src/routes/convection-feed-routes.ts', 'utf8');
  assert.match(source, /router\.prepareTransport\('convection', 'conferenceFeed'/);
  assert.match(source, /reply\.raw\.once\('close', close\)/);
  assert.match(source, /unsubscribe\(\)/);
});

test('对流 SSE 通过功能岛轮次端口执行而不在路由拼装生命周期', () => {
  const source = fs.readFileSync('src/routes/convection-stream-routes.ts', 'utf8');
  assert.match(source, /router\.prepareTransport\('convection', 'discussionRound'/);
  assert.doesNotMatch(source, /feature\.executor|beginConvectionRound|finishConvectionRound/);
});
