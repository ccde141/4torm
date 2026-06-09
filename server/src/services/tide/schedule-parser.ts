/**
 * 潮汐 — Interval 解析器（v2 复合格式）
 *
 * 支持格式：
 *   every 30s           → 30 秒
 *   every 5m            → 5 分钟
 *   every 1h            → 1 小时
 *   every 1h30m         → 1 小时 30 分钟
 *   every 2h0m15s       → 2 小时 15 秒
 * 至少一个非零分量。返回毫秒数。无效格式抛 Error。
 */

const PATTERN = /^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i;

export function parseInterval(schedule: string): number {
  const m = schedule.trim().match(PATTERN);
  if (!m) throw new Error(`无效的 schedule 格式: "${schedule}"`);
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  if (h < 0 || min < 0 || min > 59 || s < 0 || s > 59) {
    throw new Error(`分/秒 必须在 0-59 范围: "${schedule}"`);
  }
  if (h === 0 && min === 0 && s === 0) {
    throw new Error(`interval 必须 > 0: "${schedule}"`);
  }
  return h * 3_600_000 + min * 60_000 + s * 1_000;
}
