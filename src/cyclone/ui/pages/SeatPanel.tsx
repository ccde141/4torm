/**
 * 气旋工位配置面板（创建 + 编辑共用）
 *
 * 字段：绑定 agent（仅创建可选）、工位名、角色提示词、覆盖开关、职责名片（可 AI 生成）。
 * 替代三连 prompt；编辑模式由 ⚙ 设置按钮打开。
 */

import { useState } from 'react';
import type { Agent } from '../../../types';

export interface SeatDraft {
  agentId: string;
  title: string;
  rolePrompt: string;
  duty: string;
  overrideAgentRole: boolean;
}

export default function SeatPanel({ mode, agents, workshopId, initial, onSubmit, onCancel }: {
  mode: 'create' | 'edit';
  agents: Agent[];
  workshopId: string;
  initial?: Partial<SeatDraft>;
  onSubmit: (draft: SeatDraft) => Promise<void>;
  onCancel: () => void;
}) {
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
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/gen-duty`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, title: title.trim() || '工位', rolePrompt }),
      });
      if (r.ok) { const d = await r.json(); if (d.duty) setDuty(d.duty); }
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
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)', maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-lg)' }}>{mode === 'create' ? '添加工位' : `编辑工位 · ${initial?.title || ''}`}</h2>

      <label style={labelStyle}>绑定 agent</label>
      <select value={agentId} onChange={e => setAgentId(e.target.value)} disabled={mode === 'edit'} style={inputStyle}>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {mode === 'edit' && <div style={hintStyle}>绑定 agent 创建后不可更改。</div>}

      <label style={labelStyle}>工位名称</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="如：后端、架构评审、测试" style={inputStyle} />
      <div style={hintStyle}>工作室内唯一，同事靠它 contact 寻址。</div>

      <label style={labelStyle}>角色提示词（这个工位在本工作室干的活）</label>
      <textarea value={rolePrompt} onChange={e => setRolePrompt(e.target.value)} rows={5}
        placeholder="描述这个工位在本工作室的职责，例如：负责后端 API 与数据库；关注性能和安全；与「前端」工位协作时主动 contact 对齐接口。（留空则只用 agent 自身角色）"
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
        <span>覆盖 agent 基础角色</span>
      </label>
      <div style={hintStyle}>
        {override
          ? '开启：工位提示词将顶替 agent 自身人设。请确保上面的提示词完整描述了这个工位该是谁、能干什么。'
          : '不覆盖：工位提示词叠加在 agent 人设之上。记得让工位职责与 agent 原角色的工作范围相容，别互相打架。'}
      </div>

      <label style={labelStyle}>职责名片（一句话，供同事 contact 时识别）</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <input value={duty} onChange={e => setDuty(e.target.value)} placeholder="留空则用默认「补位协作者」"
          style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
        <button onClick={genDuty} disabled={genning || !agentId} className="btn" style={{ whiteSpace: 'nowrap' }}>
          {genning ? '生成中…' : 'AI 生成'}
        </button>
      </div>
      <div style={hintStyle}>AI 生成基于上面的角色提示词 + agent 人设。</div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
        <button onClick={submit} disabled={busy || !agentId || !title.trim()} className="btn btn--primary">
          {busy ? '保存中…' : (mode === 'create' ? '添加' : '保存')}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn">取消</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-1)', boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' };
