/**
 * 循环档案面板 —— 管理 AutoProfile + 兼作选档运行入口
 *
 * 由 Toolbar「自动运行」按钮触发显示（用户定：先开面板再选档）。
 * 每个档案带「运行」按钮 → onRun('auto', id)；顶部「不循环单圈」→ onRun('auto', undefined)。
 * 仿 WorkflowListPanel 的滑出面板 + fetch-on-visible + 整存整取模式。
 *
 * 本刀只做 relative 节拍（潮汐 absolute 已砍），故 UI 不暴露 cadence 类型选择。
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorkflowMode } from '../../types';
import { deleteProfile, listProfiles, saveProfiles } from '../profile-client';
import type { AutoProfile } from '../profile-client';
import { useLocale } from '../../../i18n/LocaleContext';

interface ProfilePanelProps {
  visible: boolean;
  workflowId: string;
  onClose: () => void;
  onRun: (mode: WorkflowMode, profileId?: string) => void;
}

/** 新档案默认值：30s 间隔、永续、accumulate */
function blankProfile(name = '新档案'): AutoProfile {
  return {
    id: `p-${Date.now().toString(36)}`,
    name,
    cadence: { kind: 'relative', gapSec: 30 },
    overlap: 'skip',
    lapBound: null,
    carryOver: 'accumulate',
  };
}

export function ProfilePanel({ visible, workflowId, onClose, onRun }: ProfilePanelProps) {
  const { t } = useLocale();
  const [profiles, setProfiles] = useState<AutoProfile[]>([]);
  const [editing, setEditing] = useState<AutoProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      setProfiles(await listProfiles(workflowId, t('tradewind.profile.loadFailed')));
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [workflowId, t]);

  useEffect(() => {
    if (visible) { refresh(); setEditing(null); }
  }, [visible, refresh]);

  // 整存：把当前 profiles 数组覆盖写回后端
  const persist = useCallback(async (next: AutoProfile[]) => {
    await saveProfiles(workflowId, next, t('tradewind.profile.saveFailed'));
    setProfiles(next);
  }, [workflowId]);

  const saveEdited = useCallback(async (p: AutoProfile) => {
    const idx = profiles.findIndex(x => x.id === p.id);
    const next = idx >= 0
      ? profiles.map(x => x.id === p.id ? p : x)
      : [...profiles, p];
    try {
      await persist(next);
      setError(null);
      setEditing(null);
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.profile.saveFailed'));
    }
  }, [profiles, persist, t]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteProfile(workflowId, id, t('tradewind.profile.deleteFailed'));
      setProfiles(prev => prev.filter(p => p.id !== id));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.profile.deleteFailed'));
    }
  }, [workflowId, t]);

  if (!visible) return null;

  return (
    <div className="tw-profile mo-slide-in-left">
      <div className="tw-profile__header">
        <span className="tw-profile__title">{t('tradewind.profile.title')}</span>
        <button className="tw-profile__close" onClick={onClose} aria-label={t('tradewind.profile.close')}>×</button>
      </div>
      <div className="tw-profile__body">
        {error && <div className="tw-profile__hint">{error}</div>}
        {editing
          ? <ProfileForm draft={editing} onChange={setEditing} onSave={saveEdited} onCancel={() => setEditing(null)} />
          : <ProfileList
              profiles={profiles} loading={loading}
              onRun={onRun} onClose={onClose}
              onNew={() => setEditing(blankProfile(t('tradewind.profile.newName')))}
              onEdit={setEditing} onDelete={remove}
            />}
      </div>
    </div>
  );
}

interface ProfileListProps {
  profiles: AutoProfile[];
  loading: boolean;
  onRun: (mode: WorkflowMode, profileId?: string) => void;
  onClose: () => void;
  onNew: () => void;
  onEdit: (p: AutoProfile) => void;
  onDelete: (id: string) => void;
}

function ProfileList({ profiles, loading, onRun, onClose, onNew, onEdit, onDelete }: ProfileListProps) {
  const { t } = useLocale();
  return (
    <>
      <button
        className="tw-profile__single"
        onClick={() => { onRun('auto', undefined); onClose(); }}
        title={t('tradewind.profile.singleTitle')}
      >{t('tradewind.profile.singleRun')}</button>

      <button className="tw-profile__new" onClick={onNew}>{t('tradewind.profile.new')}</button>

      {loading && <div className="tw-profile__hint">{t('common.loading')}</div>}
      {!loading && profiles.length === 0 && (
        <div className="tw-profile__hint">{t('tradewind.profile.empty')}</div>
      )}
      {profiles.map((p) => (
        <div key={p.id} className="tw-profile__item">
          <div className="tw-profile__item-main">
            <span className="tw-profile__item-name">{p.name}</span>
            <span className="tw-profile__item-meta">
              {t('tradewind.profile.interval', { seconds: p.cadence.gapSec })} · {p.lapBound === null ? t('tradewind.profile.perpetualShort') : t('tradewind.profile.lapsShort', { count: p.lapBound })}
              {' · '}{p.carryOver === 'accumulate' ? t('tradewind.profile.accumulateShort') : t('tradewind.profile.resetShort')}
            </span>
          </div>
          <div className="tw-profile__item-actions">
            <button
              className="tw-profile__item-run"
              onClick={() => { onRun('auto', p.id); onClose(); }}
              title={t('tradewind.profile.runTitle')}
            >{t('tradewind.profile.run')}</button>
            <button className="tw-profile__item-edit" onClick={() => onEdit(p)} title={t('common.edit')}>✎</button>
            <button className="tw-profile__item-del" onClick={() => onDelete(p.id)} title={t('common.delete')}>✕</button>
          </div>
        </div>
      ))}
    </>
  );
}

interface ProfileFormProps {
  draft: AutoProfile;
  onChange: (p: AutoProfile) => void;
  onSave: (p: AutoProfile) => void;
  onCancel: () => void;
}

function ProfileForm({ draft, onChange, onSave, onCancel }: ProfileFormProps) {
  const { t } = useLocale();
  const perpetual = draft.lapBound === null;
  return (
    <div className="tw-profile__form">
      <label className="tw-profile__field">
        <span>{t('tradewind.profile.name')}</span>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <label className="tw-profile__field">
        <span>{t('tradewind.profile.gap')}</span>
        <input
          type="number" min={0} value={draft.cadence.gapSec}
          onChange={(e) => onChange({ ...draft, cadence: { kind: 'relative', gapSec: Math.max(0, Number(e.target.value) || 0) } })}
        />
      </label>

      <label className="tw-profile__field tw-profile__field--row">
        <input
          type="checkbox" checked={perpetual}
          onChange={(e) => onChange({ ...draft, lapBound: e.target.checked ? null : 5 })}
        />
        <span>{t('tradewind.profile.perpetual')}</span>
      </label>
      {!perpetual && (
        <label className="tw-profile__field">
          <span>{t('tradewind.profile.lapLimit')}</span>
          <input
            type="number" min={1} value={draft.lapBound ?? 1}
            onChange={(e) => onChange({ ...draft, lapBound: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      )}

      <label className="tw-profile__field">
        <span>{t('tradewind.profile.carryOver')}</span>
        <select
          value={draft.carryOver}
          onChange={(e) => onChange({ ...draft, carryOver: e.target.value as 'accumulate' | 'reset' | 'summary' })}
        >
          <option value="accumulate">{t('tradewind.profile.accumulate')}</option>
          <option value="reset">{t('tradewind.profile.reset')}</option>
          <option value="summary">{t('tradewind.profile.summary')}</option>
        </select>
        <small className="tw-profile__hint">
          {t('tradewind.profile.carryHint')}
        </small>
      </label>

      {draft.carryOver === 'summary' && (
        <label className="tw-profile__field">
          <span>{t('tradewind.profile.summaryPrompt')}</span>
          <textarea
            rows={3} value={draft.summaryPrompt ?? ''}
            placeholder={t('tradewind.profile.summaryPlaceholder')}
            onChange={(e) => onChange({ ...draft, summaryPrompt: e.target.value || undefined })}
          />
        </label>
      )}

      <label className="tw-profile__field">
        <span>{t('tradewind.profile.loopNote')}</span>
        <textarea
          rows={3} value={draft.loopNote ?? ''}
          onChange={(e) => onChange({ ...draft, loopNote: e.target.value || undefined })}
        />
      </label>

      <div className="tw-profile__form-actions">
        <button className="tw-profile__save" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>{t('common.save')}</button>
        <button className="tw-profile__cancel" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
