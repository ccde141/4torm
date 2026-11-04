import type { WorkRecord } from '../../api/work-records';
import type { Locale, MessageKey } from '../../i18n/locale';

export function workRecordError(error: unknown): MessageKey {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'WORK_RECORD_CHANGED') return 'workRecords.changed';
  if (code === 'WORK_RECORD_UNAVAILABLE') return 'workRecords.unavailable';
  if (code === 'WORK_RECORD_CURSOR_INVALID') return 'workRecords.cursorInvalid';
  return 'workRecords.error';
}
export function workRecordDay(record: WorkRecord, locale: Locale): string {
  const date = record.date ? new Date(`${record.date}T00:00:00Z`) : new Date(record.timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale,
    { year: 'numeric', month: 'short', day: 'numeric', ...(record.date ? { timeZone: 'UTC' } : {}) }) : record.date ?? '';
}
export function workRecordTime(record: WorkRecord, locale: Locale): string {
  try { return new Date(record.timestamp).toLocaleTimeString(locale,
    { hour: '2-digit', minute: '2-digit', ...(record.timezone ? { timeZone: record.timezone } : {}) }); }
  catch { return ''; }
}
export function mergeWorkRecords(previous: WorkRecord[], incoming: WorkRecord[]): WorkRecord[] {
  const found = new Set(previous.map(record => record.id));
  return [...previous, ...incoming.filter(record => !found.has(record.id))];
}
