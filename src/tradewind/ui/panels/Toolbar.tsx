/**
 * 信风工具栏 — 工作流名称 + 保存 + 运行/停止 + 状态
 */

import { useState, useCallback, useEffect } from 'react';

interface ToolbarProps {
  workflowId: string;
  running: boolean;
  saveTime: number | null;
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onSetWorkflowId: (id: string) => void;
  onLoadList: () => void;
}

export function Toolbar({
  workflowId, running, saveTime, onRun, onStop, onSave, onSetWorkflowId, onLoadList,
}: ToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workflowId);
  const [showSaved, setShowSaved] = useState(false);

  // saveTime 变化时显示提示，3 秒后淡出
  useEffect(() => {
    if (!saveTime) return;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saveTime]);

  const startEdit = () => {
    setDraft(workflowId);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft && draft !== workflowId) onSetWorkflowId(draft);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="tw-toolbar">
      <div className="tw-toolbar__left">
        {editing ? (
          <input
            className="tw-toolbar__name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
            autoFocus
          />
        ) : (
          <div className="tw-toolbar__name-group" onDoubleClick={startEdit}>
            <span className="tw-toolbar__title">{workflowId || '未命名工作流'}</span>
            <span className="tw-toolbar__id">{workflowId}</span>
          </div>
        )}
        <button className="tw-toolbar__btn tw-toolbar__btn--ghost" onClick={onLoadList}>
          ☰
        </button>
      </div>
      <div className="tw-toolbar__actions">
        <button className="tw-toolbar__btn tw-toolbar__btn--save" onClick={onSave}>
          保存
        </button>
        {showSaved && saveTime && (
          <span className="tw-toolbar__saved-hint">已保存 {formatTime(saveTime)}</span>
        )}
        {running ? (
          <button className="tw-toolbar__btn tw-toolbar__btn--stop" onClick={onStop}>
            <span className="tw-toolbar__btn-icon">◼</span>
            停止
          </button>
        ) : (
          <button className="tw-toolbar__btn tw-toolbar__btn--run" onClick={onRun}>
            <span className="tw-toolbar__btn-icon">▶</span>
            运行
          </button>
        )}
        <div className={`tw-toolbar__status ${running ? 'tw-toolbar__status--running' : ''}`}>
          <span className="tw-toolbar__dot" />
          {running ? '执行中' : '就绪'}
        </div>
      </div>
    </div>
  );
}
