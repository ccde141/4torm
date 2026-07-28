/**
 * 信风工具栏 — 工作流名称 + 保存 + 运行/停止 + 状态
 */

import { useState, useEffect } from 'react';
import type { WorkflowMode } from '../../types';
import { phasePresentation, type ExecutionPhase } from '../hooks/execution-phase';

interface ToolbarProps {
  workflowId: string;
  workflowName: string;
  running: boolean;
  phase: ExecutionPhase;
  saveTime: number | null;
  onRun: (mode: WorkflowMode) => void;
  onOpenProfiles: () => void;
  onStop: () => void;
  onSave: () => void;
  onOpenWorkspace: () => void;
  onSetWorkflowName: (name: string) => void;
  onLoadList: () => void;
}

export function Toolbar({
  workflowId, workflowName, running, phase, saveTime, onRun, onOpenProfiles, onStop, onSave, onOpenWorkspace, onSetWorkflowName, onLoadList,
}: ToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workflowName);
  const [showSaved, setShowSaved] = useState(false);

  // saveTime 变化时显示提示，3 秒后淡出
  useEffect(() => {
    if (!saveTime) return;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saveTime]);

  const startEdit = () => {
    setDraft(workflowName);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== workflowName) onSetWorkflowName(name);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  const status = phasePresentation[phase];

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
            <span className="tw-toolbar__title">{workflowName || '未命名工作流'}</span>
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
        <button className="tw-toolbar__workspace-btn" onClick={onOpenWorkspace} title="打开当前工作流的共享工作区">
          <span className="tw-toolbar__workspace-btn-icon" aria-hidden="true">↗</span>
          <span>打开工作区</span>
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
          <>
            <button
              className="tw-toolbar__btn tw-toolbar__btn--run"
              onClick={() => onRun('manual')}
              title="手动模式：人类在场，可随时对话、介入、暂停；会议室 / 暂停点节点可用"
            >
              <span className="tw-toolbar__btn-icon">▶</span>
              手动运行
            </button>
            <button
              className="tw-toolbar__btn tw-toolbar__btn--run tw-toolbar__btn--auto"
              onClick={onOpenProfiles}
              title="自动模式：选择循环档案或单圈运行；无人值守全自动跑完，会议室 / 暂停点节点会被否决，Agent 模型须支持原生工具调用"
            >
              <span className="tw-toolbar__btn-icon">⚡</span>
              自动运行
            </button>
          </>
        )}
        <div className={`tw-toolbar__status tw-toolbar__status--${status.tone}`}>
          <span className="tw-toolbar__dot" />
          {status.label}
        </div>
      </div>
    </div>
  );
}
