const SCHEDULE_PATTERN = /^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i;

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
  if (interval <= 0) throw new Error(`interval 必须 > 0: "${schedule}"`);
  return interval;
}

export function nextTideRunAfterSuccess(
  remainingRuns: number,
  schedule: string,
  now = Date.now(),
): string | undefined {
  return remainingRuns === 0
    ? undefined
    : new Date(now + parseTideInterval(schedule)).toISOString();
}
