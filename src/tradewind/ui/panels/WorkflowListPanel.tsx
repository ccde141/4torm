/**
 * 工作流列表面板 — 显示已保存工作流，支持加载/新建/删除
 *
 * 由 Toolbar ☰ 按钮触发显示，画布内同级面板（左侧滑出）。
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';

interface WorkflowItem {
  workflowId: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
}

interface WorkflowListPanelProps {
  visible: boolean;
  currentId: string;
  onClose: () => void;
  onLoad: (workflowId: string) => void;
  onNew: () => void;
  onDelete: (workflowId: string) => Promise<void>;
}

export function WorkflowListPanel({
  visible, currentId, onClose, onLoad, onNew, onDelete,
}: WorkflowListPanelProps) {
  const { t, locale } = useLocale();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tradewind/workflow/list');
      if (res.ok) {
        const data = await res.json() as { workflows: WorkflowItem[] };
        // 只列有内容的工作流：0 节点的（新建未编辑、历史遗留的 untitled 等）不展示，
        // 避免目录里堆一堆空幽灵。文件不删，仅不显示。
        setWorkflows(data.workflows.filter(wf => wf.nodeCount > 0));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteItem = async (workflowId: string) => {
    setConfirmingDeleteId(null);
    setError(null);
    try {
      await onDelete(workflowId);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.workflowList.deleteFailed'));
    }
  };

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  if (!visible) return null;

  return (
    <div className="tw-wflist mo-slide-in-left">
      <div className="tw-wflist__header">
        <span className="tw-wflist__title">{t('tradewind.workflowList.title')}</span>
        <button className="tw-wflist__close" onClick={onClose} aria-label={t('tradewind.workflowList.close')}>×</button>
      </div>
      <div className="tw-wflist__body">
        <button className="tw-wflist__new" onClick={() => { onNew(); onClose(); }}>
          {t('tradewind.workflowList.new')}
        </button>
        {error && <div className="tw-wflist__hint">{error}</div>}
        {loading && <div className="tw-wflist__hint">{t('tradewind.workflowList.loading')}</div>}
        {!loading && workflows.length === 0 && (
          <div className="tw-wflist__hint">{t('tradewind.workflowList.empty')}</div>
        )}
        {workflows.map((wf) => (
          <div
            key={wf.workflowId}
            className={`tw-wflist__item ${wf.workflowId === currentId ? 'tw-wflist__item--active' : ''}`}
          >
            <div
              className="tw-wflist__item-main"
              onClick={() => { onLoad(wf.workflowId); onClose(); }}
            >
              <span className="tw-wflist__item-name">{wf.name}</span>
              <span className="tw-wflist__item-id">{wf.workflowId}</span>
              <span className="tw-wflist__item-meta">
                {t('tradewind.workflowList.nodeCount', { count: wf.nodeCount, time: formatTime(wf.updatedAt, locale, t) })}
              </span>
            </div>
            {confirmingDeleteId === wf.workflowId ? (
              <button
                className="tw-wflist__item-del"
                style={{ color: '#fff', background: '#ef4444', borderRadius: '4px', fontSize: '11px', padding: '1px 6px' }}
                onClick={(e) => { e.stopPropagation(); void deleteItem(wf.workflowId); }}
                title={t('tradewind.workflowList.deleteWarning')}
              >{t('tradewind.workflowList.confirm')}</button>
            ) : (
              <button
                className="tw-wflist__item-del"
                onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(wf.workflowId); setTimeout(() => setConfirmingDeleteId(prev => prev === wf.workflowId ? null : prev), 3000); }}
                title={t('tradewind.workflowList.delete')}
              >✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string, locale: 'zh-CN' | 'en-US', t: ReturnType<typeof useLocale>['t']): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return t('tradewind.workflowList.justNow');
  if (diff < 3_600_000) return t('tradewind.workflowList.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('tradewind.workflowList.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
