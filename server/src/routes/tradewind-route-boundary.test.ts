import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const routeFiles = [
  'tradewind.ts',
  'tradewind-runtime-routes.ts',
  'tradewind-node-routes.ts',
  'tradewind-meeting-stream-routes.ts',
  'tradewind-meeting-resource-routes.ts',
];

test('信风 HTTP 边界按资源拆分且聚合入口不承载业务端点', () => {
  for (const file of routeFiles) {
    const source = fs.readFileSync(`src/routes/${file}`, 'utf8');
    assert.ok(source.split(/\r?\n/).length <= 300, `${file} exceeds 300 lines`);
  }
  const facade = fs.readFileSync('src/routes/tradewind.ts', 'utf8');
  assert.doesNotMatch(facade, /app\.(get|post|delete|put|patch)\(/);
});
