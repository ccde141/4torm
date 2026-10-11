/**
 * 工作流列表面板 — 显示已保存工作流，支持加载/新建/删除
 *
 * 由 Toolbar ☰ 按钮触发显示，画布内同级面板（左侧滑出）。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import { listWorkflows, type WorkflowSummary } from '../workflow-client';
import { PresenceItems } from '../../../components/common/PresenceItems';
import { WorkflowLoadGate } from '../hooks/workflow-load-gate';

type WorkflowItem = WorkflowSummary;

interface WorkflowListPanelProps {
  visible: boolean;
  refreshKey: number;
  currentId: string;
  onClose: () => void;
  onLoad: (workflowId: string) => void;
  onNew: () => void;
  onDelete: (workflowId: string, expectedRevision: string) => Promise<void>;
}

export function WorkflowListPanel({
  visible, refreshKey, currentId, onClose, onLoad, onNew, onDelete,
}: WorkflowListPanelProps) {
  const { t, locale } = useLocale();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gateRef = useRef(new WorkflowLoadGate());
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const refresh = useCallback(async () => {
    if (!visibleRef.current) return;
    const request = gateRef.current.next();
    setLoading(true);
    try {
      const items = await listWorkflows(t('tradewind.workflowList.loadFailed'));
      if (gateRef.current.isCurrent(request) && visibleRef.current) {
        setWorkflows(items.filter(wf => wf.nodeCount > 0));
        setError(null);
      }
    } catch (cause) {
      if (gateRef.current.isCurrent(request) && visibleRef.current) {
        setError((cause as Error).message || t('tradewind.workflowList.loadFailed'));
      }
    } finally {
      if (gateRef.current.isCurrent(request)) setLoading(false);
    }
  }, [t]);

  const deleteItem = async (workflowId: string, revision: string) => {
    setConfirmingDeleteId(null);
    setError(null);
    try {
      await onDelete(workflowId, revision);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.workflowList.deleteFailed'));
    }
  };

  useEffect(() => {
    if (visible) void refresh();
    else { gateRef.current.invalidate(); setLoading(false); }
    return () => gateRef.current.invalidate();
  }, [visible, refreshKey, refresh]);

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
        <PresenceItems items={workflows} getKey={wf => wf.workflowId}
          scope="workflows" render={wf => (
          <div
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
                onClick={(e) => { e.stopPropagation(); void deleteItem(wf.workflowId, wf.revision); }}
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
        )} />
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
