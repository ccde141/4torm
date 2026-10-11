import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routeFiles = [
  'cyclone.ts',
  'cyclone-route-support.ts',
  'cyclone-workshop-routes.ts',
  'cyclone-seat-routes.ts',
  'cyclone-chair-routes.ts',
  'cyclone-room-routes.ts',
];

test('气旋 HTTP 适配器按资源拆分且每个文件不超过 300 行', () => {
  for (const file of routeFiles) {
    const source = fs.readFileSync(path.resolve('src/routes', file), 'utf8');
    assert.ok(source.split(/\r?\n/).length <= 300, `${file} 超过 300 行`);
  }
});

test('气旋资源路由不再承载历史消息与上下文写操作', () => {
  const source = ['cyclone-seat-routes.ts', 'cyclone-room-routes.ts', 'cyclone-chair-routes.ts']
    .map(file => fs.readFileSync(`src/routes/${file}`, 'utf8')).join('\n');
  assert.doesNotMatch(source, /editSeatMessage|editRoomMessage|editChairMessage/);
  assert.doesNotMatch(source, /resetSeatContext|resetRoomContext|resetChairContext/);
});

test('气旋总入口只负责登记资源路由', () => {
  const source = fs.readFileSync('src/routes/cyclone.ts', 'utf8');
  assert.match(source, /registerCycloneSeatRoutes/);
  assert.match(source, /registerCycloneChairRoutes/);
  assert.match(source, /registerCycloneRoomRoutes/);
  assert.match(source, /registerCycloneWorkshopRoutes/);
  assert.doesNotMatch(source, /app\.(all|get|post|delete|put|patch)\(/);
  assert.doesNotMatch(source, /engine\/cyclone/);
});
