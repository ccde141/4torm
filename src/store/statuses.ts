/** Agent 状态筛选的预设展示值；真实活动状态由探针投影。 */
import type { MessageKey } from '../i18n/locale';

export interface SystemStatusDef {
  id: string;
  label: string;
  labelKey: MessageKey;
  color: string;
}

export const SYSTEM_STATUSES: SystemStatusDef[] = [
  { id: 'idle', label: '空闲', labelKey: 'dashboard.status.idle', color: '#4ade80' },
  { id: 'busy', label: '工作中', labelKey: 'dashboard.status.running', color: '#fbbf24' },
  { id: 'offline', label: '离线', labelKey: 'dashboard.filter.offline', color: '#ef4444' },
];
