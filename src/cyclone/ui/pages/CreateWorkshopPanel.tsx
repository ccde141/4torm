/**
 * 气旋创建工作室配置面板
 *
 * 替代 prompt：右侧主界面填工作室名 + 选会议助理 agent（场外参谋，可不选）。
 * 取消即放弃，不会误建。
 */

import { useState } from 'react';
import type { Agent } from '../../../types';
import { useLocale } from '../../../i18n/LocaleContext';

export default function CreateWorkshopPanel({ agents, onCreate, onCancel }: {
  agents: Agent[];
  onCreate: (cfg: { title: string; chairAgentId?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [title, setTitle] = useState(() => t('cyclone.workshop.defaultTitle'));
  const [chairAgentId, setChairAgentId] = useState('');
  const [creating, setCreating] = useState(false);

  async function submit() {
    if (creating) return;
    setCreating(true);
    try {
      await onCreate({ title: title.trim() || t('cyclone.workshop.defaultTitle'), chairAgentId: chairAgentId || undefined });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)', maxWidth: 560 }}>
      <h2 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-lg)' }}>{t('cyclone.workshop.createTitle')}</h2>

      <label style={labelStyle}>{t('cyclone.workshop.name')}</label>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={inputStyle} />

      <label style={labelStyle}>{t('cyclone.workshop.chairLabel')}</label>
      <select value={chairAgentId} onChange={e => setChairAgentId(e.target.value)} style={inputStyle}>
        <option value="">{t('cyclone.workshop.noChair')}</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-5)' }}>
        {t('cyclone.workshop.chairHint')}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={submit} disabled={creating} className="btn btn--primary">
          {creating ? t('cyclone.workshop.creating') : t('cyclone.workshop.create')}
        </button>
        <button onClick={onCancel} disabled={creating} className="btn">{t('common.cancel')}</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', boxSizing: 'border-box' };
