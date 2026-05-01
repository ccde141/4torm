/**
 * ============================================================
 *  StatCard Component
 * ============================================================
 *  统计卡片。展示单个指标数据。
 * ============================================================
 */

import '../../styles/components/stats.css';

interface StatCardProps {
  label: string;
  value: string | number;
  change?: { value: string; up: boolean };
}

export default function StatCard({ label, value, change }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {change && (
        <span className={`stat-card__change ${change.up ? 'stat-card__change--up' : 'stat-card__change--down'}`}>
          {change.up ? '↑' : '↓'} {change.value}
        </span>
      )}
    </div>
  );
}
