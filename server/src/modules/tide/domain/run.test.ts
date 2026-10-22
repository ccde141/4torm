import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTideRunRecord } from './run.js';

function record(args: unknown) {
  return { taskId: 'task-a', timestamp: '2026-10-21T00:00:00.000Z',
    status: 'success', sessionId: 'session-a', answer: '完成', rawContent: '完成',
    toolCalls: [{ tool: 'mcp:desktop:act', args, result: 'ok' }], turns: 1, durationMs: 5 };
}

test('潮汐运行记录接受工具 JSON 参数并兼容旧字符串参数', () => {
  const args = { window: 68422, wait: false, bounds: [0, 0, 100, 100],
    options: { pointer: { x: 12.5, y: -3 }, label: '桌面', fallback: null }, empty: {} };
  assert.deepEqual(parseTideRunRecord(record(args)).toolCalls[0]?.args, args);
  const legacy = { window: '68422', wait: 'false', bounds: '[0,0,100,100]' };
  assert.deepEqual(parseTideRunRecord(record(legacy)).toolCalls[0]?.args, legacy);
  assert.deepEqual(parseTideRunRecord(record({})).toolCalls[0]?.args, {});
});

test('潮汐运行记录允许 JSON 对象复用，拒绝循环引用与非 JSON 工具参数', () => {
  const shared = { name: 'same' };
  assert.doesNotThrow(() => parseTideRunRecord(record({ first: shared, second: shared })));
  const nullPrototype = Object.assign(Object.create(null), { count: 1 });
  assert.doesNotThrow(() => parseTideRunRecord(record(nullPrototype)));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const arrayCycle: unknown[] = [];
  arrayCycle.push(arrayCycle);
  class CustomArray extends Array { toJSON() { return 'changed'; } }
  for (const args of [null, [], 'string', { cycle }, { arrayCycle },
    { bad: undefined }, { bad: () => 1 }, { bad: Symbol('bad') }, { bad: 1n },
    { bad: NaN }, { bad: Infinity }, { bad: -Infinity }, { bad: new Date() },
    { bad: new Map() }, { bad: Object.create({ inherited: 'not JSON' }) },
    { bad: [undefined] }, { bad: new Array(2) }, { bad: new CustomArray() }]) {
    assert.throws(() => parseTideRunRecord(record(args)), /invalid toolCalls/);
  }
});

test('潮汐工具参数校验不执行访问器、不静默丢弃对象或数组字段', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true, get() { reads += 1; return 1; },
  });
  const hidden = Object.defineProperty({}, 'value', { value: 1 });
  const symbol = { [Symbol('value')]: 1 };
  const extraArray = Object.assign([1], { extra: 2 });
  const sparseWithExtra = Object.assign(new Array(1), { extra: 2 });
  for (const args of [accessor, hidden, symbol, { bad: extraArray }, { bad: sparseWithExtra }]) {
    assert.throws(() => parseTideRunRecord(record(args)), /invalid toolCalls/);
  }
  assert.equal(reads, 0);
});
