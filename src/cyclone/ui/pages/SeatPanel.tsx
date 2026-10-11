/**
 * 气旋工位配置面板（创建 + 编辑共用）
 *
 * 字段：绑定 agent、工位名、角色提示词、覆盖开关、职责名片（可 AI 生成）。
 * 替代三连 prompt；编辑模式由 ⚙ 设置按钮打开。
 */

import { useState } from 'react';
import type { Agent } from '../../../types';
import { useLocale } from '../../../i18n/LocaleContext';
import { generateCycloneSeatDuty } from './cyclone-control-client';

export interface SeatDraft {
  agentId: string;
  title: string;
  rolePrompt: string;
  duty: string;
  overrideAgentRole: boolean;
}

export default function SeatPanel({ mode, agents, initial, onSubmit, onCancel }: {
  mode: 'create' | 'edit';
  agents: Agent[];
  initial?: Partial<SeatDraft>;
  onSubmit: (draft: SeatDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [agentId, setAgentId] = useState(initial?.agentId || agents[0]?.id || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [rolePrompt, setRolePrompt] = useState(initial?.rolePrompt || '');
  const [duty, setDuty] = useState(initial?.duty || '');
  const [override, setOverride] = useState(initial?.overrideAgentRole || false);
  const [busy, setBusy] = useState(false);
  const [genning, setGenning] = useState(false);

  async function genDuty() {
    if (!agentId || genning) return;
    setGenning(true);
    try {
      const d = await generateCycloneSeatDuty(
        agentId, title.trim() || t('cyclone.seat.fallbackTitle'), rolePrompt,
      );
      if (d.duty) setDuty(d.duty);
    } catch (error) {
      alert(`${t('cyclone.seat.generateFailed', { status: '' })}: ${(error as Error).message}`);
    } finally {
      setGenning(false);
    }
  }

  async function submit() {
    if (busy || !agentId || !title.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ agentId, title: title.trim(), rolePrompt, duty: duty.trim(), overrideAgentRole: override });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cyclone__seat-editor-scroll">
      <section className="cyclone__seat-editor mo-enter-fade-up" aria-labelledby="cyclone-seat-editor-title">
      <h2 id="cyclone-seat-editor-title" className="cyclone__seat-editor-title">{mode === 'create' ? t('cyclone.seat.createTitle') : t('cyclone.seat.editTitle', { title: initial?.title || '' })}</h2>

      <label style={labelStyle}>{t('cyclone.seat.agent')}</label>
      <select value={agentId} onChange={e => setAgentId(e.target.value)} style={inputStyle}>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {mode === 'edit' && <div style={hintStyle}>{t('cyclone.seat.agentChangedHint')}</div>}

      <label style={labelStyle}>{t('cyclone.seat.name')}</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('cyclone.seat.namePlaceholder')} style={inputStyle} />
      <div style={hintStyle}>{t('cyclone.seat.nameHint')}</div>

      <label style={labelStyle}>{t('cyclone.seat.rolePrompt')}</label>
      <textarea value={rolePrompt} onChange={e => setRolePrompt(e.target.value)} rows={5}
        placeholder={t('cyclone.seat.rolePlaceholder')}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
        <span>{t('cyclone.seat.override')}</span>
      </label>
      <div style={hintStyle}>
        {override
          ? t('cyclone.seat.overrideOn')
          : t('cyclone.seat.overrideOff')}
      </div>

      <label style={labelStyle}>{t('cyclone.seat.duty')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <input value={duty} onChange={e => setDuty(e.target.value)} placeholder={t('cyclone.seat.dutyPlaceholder')}
          style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
        <button onClick={genDuty} disabled={genning || !agentId} className="secondary-action-btn" style={{ whiteSpace: 'nowrap' }}>
          {genning ? t('cyclone.seat.generating') : t('cyclone.seat.generate')}
        </button>
      </div>
      <div style={hintStyle}>{t('cyclone.seat.generateHint')}</div>

      <div className="cyclone__seat-editor-actions">
        <button onClick={submit} disabled={busy || !agentId || !title.trim()} className="primary-cta-btn">
          {busy ? t('cyclone.seat.saving') : t(mode === 'create' ? 'cyclone.seat.create' : 'cyclone.seat.save')}
        </button>
        <button onClick={onCancel} disabled={busy} className="secondary-action-btn">{t('common.cancel')}</button>
      </div>
      </section>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-1)', boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' };
