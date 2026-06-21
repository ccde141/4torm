/**
 * 气旋创建工作室配置面板
 *
 * 替代 prompt：右侧主界面填工作室名 + 选会长 agent（场外参谋，可不选）。
 * 取消即放弃，不会误建。
 */

import { useState } from 'react';
import type { Agent } from '../../../types';

export default function CreateWorkshopPanel({ agents, onCreate, onCancel }: {
  agents: Agent[];
  onCreate: (cfg: { title: string; chairAgentId?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('新工作室');
  const [chairAgentId, setChairAgentId] = useState('');
  const [creating, setCreating] = useState(false);

  async function submit() {
    if (creating) return;
    setCreating(true);
    try {
      await onCreate({ title: title.trim() || '新工作室', chairAgentId: chairAgentId || undefined });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)', maxWidth: 560 }}>
      <h2 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-lg)' }}>新建工作室</h2>

      <label style={labelStyle}>工作室名称</label>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={inputStyle} />

      <label style={labelStyle}>会长 agent（场外参谋，可不设）</label>
      <select value={chairAgentId} onChange={e => setChairAgentId(e.target.value)} style={inputStyle}>
        <option value="">不设会长</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-5)' }}>
        会长不占工位，负责场外私聊参谋与整理，可之后再设。
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={submit} disabled={creating} className="btn btn--primary">
          {creating ? '创建中…' : '创建'}
        </button>
        <button onClick={onCancel} disabled={creating} className="btn">取消</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', boxSizing: 'border-box' };
