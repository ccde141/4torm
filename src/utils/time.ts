/**
 * 时间格式化工具
 * 服务器/浏览器均为北京时间（UTC+8），直接用本地时间
 */

export function formatTimestamp(iso: string, full?: boolean): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (full) {
    return `${y}-${M}-${dd} ${hh}:${mm}:${ss}`;
  }
  return `${M}-${dd} ${hh}:${mm}`;
}
