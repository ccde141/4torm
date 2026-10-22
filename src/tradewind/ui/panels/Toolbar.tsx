/**
 * 信风工具栏 — 工作流名称 + 保存 + 运行/停止 + 状态
 */

import { useState, useEffect } from 'react';
import type { WorkflowMode } from '../../types';
import { phasePresentation, type ExecutionPhase } from '../hooks/execution-phase';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';

const PHASE_KEY: Record<ExecutionPhase, MessageKey> = {
  idle: 'tradewind.phase.idle', running: 'tradewind.phase.running',
  completed: 'tradewind.phase.completed', stopped: 'tradewind.phase.stopped',
  failed: 'tradewind.phase.failed', interrupted: 'tradewind.phase.interrupted',
};

interface ToolbarProps {
  runDisabled?: boolean;
  disabledReason?: string;
  orchestration?: 'strict' | 'handoff';
  workflowId: string;
  workflowName: string;
  activeWorkflowId?: string | null;
  running: boolean;
  phase: ExecutionPhase;
  saveTime: number | null;
  saving?: boolean;
  openingWorkspace?: boolean;
  onRun: (mode: WorkflowMode) => void;
  onOpenProfiles: () => void;
  onStop: () => void;
  onSave: () => void;
  onOpenWorkspace: () => void;
  onSetWorkflowName: (name: string) => void;
  onLoadList: () => void;
}

export function Toolbar({
  workflowId, workflowName, activeWorkflowId, running, phase, saveTime, saving, openingWorkspace, onRun, onOpenProfiles, onStop, onSave, onOpenWorkspace, onSetWorkflowName, onLoadList, runDisabled, disabledReason, orchestration,
}: ToolbarProps) {
  const { t, locale } = useLocale();
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
            <span className="tw-toolbar__title">{workflowName || t('tradewind.untitled')}</span>
            <span className="tw-toolbar__id">{orchestration && `${locale === 'zh-CN' ? (orchestration === 'strict' ? '严格依赖' : '条件交接') : (orchestration === 'strict' ? 'Strict dependency' : 'Conditional handoff')} · `}{workflowId}</span>
          </div>
        )}
        <button className="tw-toolbar__btn tw-toolbar__btn--ghost" onClick={onLoadList}
          aria-label={locale === 'zh-CN' ? '显示或收起工作流列表' : 'Toggle workflow list'}>
          ☰
        </button>
      </div>
      <div className="tw-toolbar__actions">
        <button className="tw-toolbar__btn tw-toolbar__btn--save" onClick={onSave} aria-busy={saving}>
          {t(saving ? 'tradewind.toolbar.saving' : 'tradewind.toolbar.save')}
        </button>
        <button className="tw-toolbar__workspace-btn" onClick={onOpenWorkspace} disabled={openingWorkspace}
          aria-busy={openingWorkspace} title={t('tradewind.toolbar.workspaceTitle')}>
          <span className="tw-toolbar__workspace-btn-icon" aria-hidden="true">↗</span>
          <span>{t(openingWorkspace ? 'tradewind.toolbar.openingWorkspace' : 'tradewind.toolbar.openWorkspace')}</span>
        </button>
        {showSaved && saveTime && (
          <span className="tw-toolbar__saved-hint">{t('tradewind.toolbar.savedAt', { time: formatTime(saveTime) })}</span>
        )}
        {running && activeWorkflowId && activeWorkflowId !== workflowId && (
          <span className="tw-toolbar__saved-hint" role="status">
            {locale === 'zh-CN' ? `运行中：${activeWorkflowId}` : `Running: ${activeWorkflowId}`}
          </span>
        )}
        {running ? (
          <button className="tw-toolbar__btn tw-toolbar__btn--stop" onClick={onStop}>
            <span className="tw-toolbar__btn-icon">◼</span>
            {t('tradewind.toolbar.stop')}
          </button>
        ) : (
          <>
            <button
              className="tw-toolbar__btn tw-toolbar__btn--run"
              onClick={() => onRun('manual')}
              disabled={runDisabled}
              title={disabledReason ?? t('tradewind.toolbar.manualTitle')}
            >
              <span className="tw-toolbar__btn-icon">▶</span>
              {t('tradewind.toolbar.manualRun')}
            </button>
            <button
              className="tw-toolbar__btn tw-toolbar__btn--run tw-toolbar__btn--auto"
              onClick={onOpenProfiles}
              disabled={runDisabled}
              title={disabledReason ?? t('tradewind.toolbar.autoTitle')}
            >
              <span className="tw-toolbar__btn-icon">⚡</span>
              {t('tradewind.toolbar.autoRun')}
            </button>
          </>
        )}
        <div className={`tw-toolbar__status tw-toolbar__status--${status.tone}`}>
          <span className="tw-toolbar__dot" />
          {t(PHASE_KEY[phase])}
        </div>
      </div>
    </div>
  );
}
