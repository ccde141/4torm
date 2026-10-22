const SCHEDULE_PATTERN = /^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i;
const DAILY_PATTERN = /^daily\s+([01]\d|2[0-3]):([0-5]\d)$/i;

export type TideSchedule = { kind: 'interval'; intervalMs: number }
  | { kind: 'daily'; hour: number; minute: number };

export function parseTideSchedule(schedule: string): TideSchedule {
  const daily = schedule.trim().match(DAILY_PATTERN);
  if (daily) return { kind: 'daily', hour: Number(daily[1]), minute: Number(daily[2]) };
  return { kind: 'interval', intervalMs: parseTideInterval(schedule) };
}

export function parseTideInterval(schedule: string): number {
  const match = schedule.trim().match(SCHEDULE_PATTERN);
  if (!match) throw new Error(`无效的 schedule 格式: "${schedule}"`);
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  if (minutes > 59 || seconds > 59) {
    throw new Error(`分/秒 必须在 0-59 范围: "${schedule}"`);
  }
  const interval = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000;
  if (!Number.isSafeInteger(interval) || interval <= 0) throw new Error(`interval 必须是有效的正毫秒数: "${schedule}"`);
  return interval;
}

/** Daily schedules follow the backend's current local clock, including calendar/DST changes. */
export function nextTideRun(schedule: string, now = Date.now()): string {
  const plan = parseTideSchedule(schedule);
  if (plan.kind === 'interval') return new Date(now + plan.intervalMs).toISOString();
  const today = new Date(now);
  for (let day = 0; day < 4; day++) {
    const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day,
      plan.hour, plan.minute, 0, 0);
    // A missing spring-forward time must not silently move to a different local time.
    // Date selects the first occurrence of a repeated local time, so it is used only once.
    if (candidate.getHours() === plan.hour && candidate.getMinutes() === plan.minute
      && candidate.getTime() > now) return candidate.toISOString();
  }
  throw new Error(`无法计算下次潮汐触发时间: "${schedule}"`);
}

export function nextTideRunAfterSuccess(
  remainingRuns: number,
  schedule: string,
  now = Date.now(),
): string | undefined {
  return remainingRuns === 0
    ? undefined
    : nextTideRun(schedule, now);
}
