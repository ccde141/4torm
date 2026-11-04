import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkRecord } from '../../api/work-records';
import { resolveMessage } from '../../i18n/locale';
import { workRecordZh } from '../../i18n/work-record-messages';
import { mergeWorkRecords, workRecordDay, workRecordError, workRecordTime } from './work-record-view';

const record: WorkRecord = { id: 'work:a', revision: 'a', title: 'Project', summary: 'Saved',
  timestamp: '2026-11-01T00:00:00Z', date: '2026-11-01', timezone: 'Asia/Shanghai' };
test('record display preserves source day and timezone independently of browser timezone', () => {
  assert.match(workRecordDay(record, 'en-US'), /Nov.*1.*2026/);
  assert.match(workRecordTime(record, 'zh-CN'), /08:00/);
  assert.equal(workRecordTime({ ...record, timezone: 'invalid' }, 'en-US'), '');
});
test('overlapping pages do not duplicate records or change the selected historical version', () => {
  const next = { ...record, id: 'work:b' };
  assert.deepEqual(mergeWorkRecords([record], [{ ...record, revision: 'changed' }, next]), [record, next]);
});
test('record states have complete bilingual messages and no raw server message in the interface', () => {
  for (const key of Object.keys(workRecordZh)) {
    assert.notEqual(resolveMessage('zh-CN', key), key); assert.notEqual(resolveMessage('en-US', key), key);
  }
  assert.equal(workRecordError({ code: 'WORK_RECORD_UNAVAILABLE' }), 'workRecords.unavailable');
  assert.equal(workRecordError({ code: 'WORK_RECORD_CHANGED' }), 'workRecords.changed');
  assert.equal(workRecordError(new Error('private path')), 'workRecords.error');
});
