import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTideSchedule, parseTideRepeatCountInput, parseTideScheduleForm, validateTideScheduleForm } from './tide-form-values.js';

test('重复次数输入保留零，空输入才回退为永续', () => {
  assert.equal(parseTideRepeatCountInput('0'), 0);
  assert.equal(parseTideRepeatCountInput('1'), 1);
  assert.equal(parseTideRepeatCountInput('-1'), -1);
  assert.equal(parseTideRepeatCountInput(''), -1);
});

test('每日定时表单保留两位本地时间，午夜也是有效的触发时点', () => {
  for (const time of ['00:00', '08:00', '23:59']) {
    const form = parseTideScheduleForm(`daily ${time}`);
    assert.equal(form.scheduleMode, 'daily');
    assert.equal(form.dailyTime, time);
    assert.equal(validateTideScheduleForm(form), null);
    assert.equal(buildTideSchedule(form), `daily ${time}`);
  }
});

test('定时和间隔切换时，只验证当前启用的方式，不会把每日任务转为零间隔', () => {
  const daily = parseTideScheduleForm('daily 08:00');
  assert.equal(validateTideScheduleForm(daily), null);
  assert.equal(validateTideScheduleForm({ ...daily, scheduleMode: 'interval' }), 'interval');
  for (const dailyTime of ['', '8:00', '24:00', '08:60', '08:00:00']) {
    assert.equal(validateTideScheduleForm({ ...daily, dailyTime }), 'time');
  }
});

test('间隔表单保留原有时分秒与秒级调度', () => {
  const form = parseTideScheduleForm('every 1h30m5s');
  assert.equal(validateTideScheduleForm(form), null);
  assert.equal(buildTideSchedule(form), 'every 1h30m5s');
  assert.equal(buildTideSchedule(parseTideScheduleForm('every 1s')), 'every 0h0m1s');
  assert.equal(validateTideScheduleForm({ ...form, scheduleH: -1 }), 'range');
  assert.equal(validateTideScheduleForm({ ...form, scheduleM: 60 }), 'range');
  assert.equal(validateTideScheduleForm({ ...form, scheduleS: 0.5 }), 'range');
});
