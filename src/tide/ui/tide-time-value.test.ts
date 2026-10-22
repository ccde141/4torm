import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTideTimePart, replaceTideTimePart, stepTideTimePart, tideTimePartIsValid } from './tide-time-value';
import { parseTideScheduleForm, validateTideScheduleForm } from './tide-form-values';

test('分段编辑保留另一段和临时空值，不能把不完整时间误当为有效计划', () => {
  assert.equal(replaceTideTimePart('08:30', 0, '12'), '12:30');
  assert.equal(replaceTideTimePart('08:30', 1, ''), '08:');
  assert.equal(validateTideScheduleForm({ ...parseTideScheduleForm('daily 08:30'), dailyTime: '08:' }), 'time');
  assert.equal(tideTimePartIsValid('', 59), false);
  assert.equal(tideTimePartIsValid('24', 23), false);
  assert.equal(tideTimePartIsValid('60', 59), false);
});

test('确认编辑时补齐个位数，但不静默修正越界或非数字输入', () => {
  assert.equal(normalizeTideTimePart('8'), '08');
  assert.equal(normalizeTideTimePart('0'), '00');
  assert.equal(normalizeTideTimePart('99'), '99');
  assert.equal(normalizeTideTimePart(''), '');
  assert.equal(normalizeTideTimePart('x'), 'x');
});

test('时间键盘步进遵守各段范围，Home 和 End 到达首末值', () => {
  assert.equal(stepTideTimePart('23', 23, 'ArrowUp'), '00');
  assert.equal(stepTideTimePart('00', 23, 'ArrowDown'), '23');
  assert.equal(stepTideTimePart('59', 59, 'ArrowUp'), '00');
  assert.equal(stepTideTimePart('15', 59, 'ArrowDown'), '14');
  assert.equal(stepTideTimePart('15', 23, 'Home'), '00');
  assert.equal(stepTideTimePart('15', 23, 'End'), '23');
  assert.equal(stepTideTimePart('15', 59, 'End'), '59');
  assert.equal(stepTideTimePart('15', 59, 'Tab'), null);
});
