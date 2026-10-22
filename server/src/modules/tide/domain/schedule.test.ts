import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { nextTideRun, nextTideRunAfterSuccess, parseTideSchedule } from './schedule.js';

test('最后一次成功执行后不再保留过期的下次触发时间', () => {
  assert.equal(nextTideRunAfterSuccess(0, 'every 10s', 1000), undefined);
  assert.equal(nextTideRunAfterSuccess(2, 'every 10s', 1000), '1970-01-01T00:00:11.000Z');
  assert.equal(nextTideRunAfterSuccess(-1, 'every 10s', 1000), '1970-01-01T00:00:11.000Z');
});

test('每日计划严格使用24小时时分，间隔格式继续兼容', () => {
  assert.deepEqual(parseTideSchedule('daily 08:00'), { kind: 'daily', hour: 8, minute: 0 });
  assert.deepEqual(parseTideSchedule('daily 00:00'), { kind: 'daily', hour: 0, minute: 0 });
  assert.deepEqual(parseTideSchedule('every 1h2m3s'), { kind: 'interval', intervalMs: 3_723_000 });
  for (const schedule of ['daily 8:00', 'daily 24:00', 'daily 08:60', 'daily 08:00:00',
    'daily', 'every 0s', 'every 1m60s']) assert.throws(() => parseTideSchedule(schedule), schedule);
});

test('每日下一次只计算未来本地日期，过点和午夜均不按24小时相加', () => {
  const before = new Date(2026, 9, 21, 7, 59, 59).getTime();
  const point = new Date(2026, 9, 21, 8, 0, 0).getTime();
  assert.equal(nextTideRun('daily 08:00', before), new Date(point).toISOString());
  assert.equal(nextTideRun('daily 08:00', point), new Date(2026, 9, 22, 8).toISOString());
  assert.equal(nextTideRun('daily 08:00', point + 60_000), new Date(2026, 9, 22, 8).toISOString());
  assert.equal(nextTideRun('daily 00:00', new Date(2026, 11, 31, 23, 59).getTime()),
    new Date(2027, 0, 1).toISOString());
  assert.equal(nextTideRunAfterSuccess(0, 'daily 08:00', point), undefined);
  assert.equal(nextTideRunAfterSuccess(-1, 'daily 08:00', point), new Date(2026, 9, 22, 8).toISOString());
});

test('每日计划跳过夏令时不存在时分，重复时分仅选首个，进程本地时区决定UTC时点', () => {
  const source = new URL('./schedule.ts', import.meta.url).href;
  const script = `import { nextTideRun } from ${JSON.stringify(source)};
    console.log(JSON.stringify([
      nextTideRun('daily 02:30', Date.parse('2026-03-08T06:00:00Z')),
      nextTideRun('daily 01:30', Date.parse('2026-11-01T04:30:00Z')),
      nextTideRun('daily 01:30', Date.parse('2026-11-01T06:00:00Z')),
      nextTideRun('daily 08:00', Date.parse('2026-10-21T00:00:00Z'))
    ]));`;
  const inZone = (zone: string): string[] => JSON.parse(execFileSync(process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 10_000 }));
  const ny = inZone('America/New_York');
  assert.deepEqual(ny.slice(0, 3), ['2026-03-09T06:30:00.000Z',
    '2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  assert.equal(ny[3], '2026-10-21T12:00:00.000Z');
  assert.equal(inZone('Asia/Shanghai')[3], '2026-10-22T00:00:00.000Z');
});
