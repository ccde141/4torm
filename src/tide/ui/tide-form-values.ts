export function parseTideRepeatCountInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}

export interface TideScheduleForm {
  scheduleMode: 'interval' | 'daily';
  dailyTime: string;
  scheduleH: number;
  scheduleM: number;
  scheduleS: number;
}

const dailyTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseTideScheduleForm(schedule: string): TideScheduleForm {
  const daily = /^daily\s+(\d{2}:\d{2})$/i.exec(schedule);
  const interval = /^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i.exec(schedule);
  return {
    scheduleMode: daily ? 'daily' : 'interval', dailyTime: daily?.[1] ?? '08:00',
    scheduleH: Number(interval?.[1] ?? 0), scheduleM: Number(interval?.[2] ?? 0),
    scheduleS: Number(interval?.[3] ?? 0),
  };
}

export function validateTideScheduleForm(form: TideScheduleForm): 'time' | 'range' | 'interval' | null {
  if (form.scheduleMode === 'daily') return dailyTimePattern.test(form.dailyTime) ? null : 'time';
  const { scheduleH: h, scheduleM: m, scheduleS: s } = form;
  if (![h, m, s].every(value => Number.isInteger(value) && value >= 0) || m > 59 || s > 59) return 'range';
  return h === 0 && m === 0 && s === 0 ? 'interval' : null;
}

export function buildTideSchedule(form: TideScheduleForm): string {
  return form.scheduleMode === 'daily' ? `daily ${form.dailyTime}`
    : `every ${form.scheduleH}h${form.scheduleM}m${form.scheduleS}s`;
}
