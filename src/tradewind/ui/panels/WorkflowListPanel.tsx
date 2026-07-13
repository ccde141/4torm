/**
 * 工作流列表面板 — 显示已保存工作流，支持加载/新建/删除
 *
 * 由 Toolbar ☰ 按钮触发显示，画布内同级面板（左侧滑出）。
 */

import { useState, useEffect, useCallback } from 'react';

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
  onDelete: (workflowId: string) => void;
}

export function WorkflowListPanel({
  visible, currentId, onClose, onLoad, onNew, onDelete,
}: WorkflowListPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  if (!visible) return null;

  return (
    <div className="tw-wflist mo-slide-in-left">
      <div className="tw-wflist__header">
        <span className="tw-wflist__title">工作流</span>
        <button className="tw-wflist__close" onClick={onClose}>×</button>
      </div>
      <div className="tw-wflist__body">
        <button className="tw-wflist__new" onClick={() => { onNew(); onClose(); }}>
          + 新建工作流
        </button>
        {loading && <div className="tw-wflist__hint">加载中...</div>}
        {!loading && workflows.length === 0 && (
          <div className="tw-wflist__hint">暂无已保存的工作流</div>
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
                {wf.nodeCount} 节点 · {formatTime(wf.updatedAt)}
              </span>
            </div>
            {confirmingDeleteId === wf.workflowId ? (
              <button
                className="tw-wflist__item-del"
                style={{ color: '#fff', background: '#ef4444', borderRadius: '4px', fontSize: '11px', padding: '1px 6px' }}
                onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); onDelete(wf.workflowId); refresh(); }}
                title="工作流及运行数据将被清空"
              >确认?</button>
            ) : (
              <button
                className="tw-wflist__item-del"
                onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(wf.workflowId); setTimeout(() => setConfirmingDeleteId(prev => prev === wf.workflowId ? null : prev), 3000); }}
                title="删除"
              >✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
