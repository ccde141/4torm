/** Agent 状态筛选的预设展示值；真实活动状态由探针投影。 */

export interface SystemStatusDef {
  id: string;
  label: string;
  color: string;
}

export const SYSTEM_STATUSES: SystemStatusDef[] = [
  { id: 'idle',       label: '空闲',   color: '#4ade80' },
  { id: 'busy',       label: '工作中', color: '#fbbf24' },
  { id: 'offline',    label: '离线',   color: '#ef4444' },
];
