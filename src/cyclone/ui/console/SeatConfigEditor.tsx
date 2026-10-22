import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../../../types';
import { updateCycloneSeat } from '../pages/cyclone-control-client';
import type { ConsoleSeat } from './workshop-console-model';
import { useConsoleText } from './console-text';

export function SeatConfigEditor({ workshopId, seat, agents, onChanged }: {
  workshopId: string; seat: ConsoleSeat; agents: Agent[]; onChanged(): void;
}) {
  const text = useConsoleText();
  // Draft identity is the seat, not each live snapshot. Incoming events cannot replace user input.
  const [draft, setDraft] = useState({ title: seat.title, agentId: seat.agentId, duty: seat.duty ?? '',
    rolePrompt: seat.rolePrompt, overrideAgentRole: seat.overrideAgentRole });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function change<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft(current => ({ ...current, [key]: value })); setSaved(false);
  }
  async function save() {
    if (busy || !draft.agentId || !draft.title.trim()) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      await updateCycloneSeat(workshopId, seat.id, { ...draft, title: draft.title.trim(), duty: draft.duty.trim() });
      if (!alive.current) return;
      setSaved(true); onChanged();
    } catch (cause) { if (alive.current) setError(String((cause as Error).message || cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <form className="cy-seat-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="cy-seat-intro"><h3>{text('工位配置与岗位提示词', 'Seat configuration and role')}</h3></div>
    <fieldset disabled={busy}><div className="cy-seat-form__grid">
      <label>{text('工位名称', 'Seat name')}<input value={draft.title} required maxLength={100} onChange={event => change('title', event.target.value)} /></label>
      <label>{text('绑定 Agent', 'Bound Agent')}<select value={draft.agentId} onChange={event => change('agentId', event.target.value)} required>
        {!agents.some(agent => agent.id === draft.agentId) && <option value={draft.agentId}>{draft.agentId} · {text('不可用', 'Unavailable')}</option>}
        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    </div><label>{text('岗位职责', 'Duty')}<textarea value={draft.duty} rows={2} maxLength={4000} onChange={event => change('duty', event.target.value)} /></label>
      <label>{text('工位提示词', 'Seat prompt')}<textarea className="cy-seat-prompt" value={draft.rolePrompt} rows={9}
        maxLength={100000} onChange={event => change('rolePrompt', event.target.value)} /></label>
      <label className="cy-seat-checkbox"><input type="checkbox" checked={draft.overrideAgentRole} onChange={event => change('overrideAgentRole', event.target.checked)} />
        {text('用工位提示词替代 Agent 默认角色', 'Replace the Agent’s default role with the seat prompt')}</label>
      <p className="cy-console-muted">{draft.overrideAgentRole ? text('角色来源：工位提示词', 'Role source: seat prompt')
        : text('角色组合：Agent 默认角色 + 工位提示词', 'Role: Agent default role + seat prompt')}</p>
    </fieldset>
    {error && <p role="alert" className="cy-console-error">{error}</p>}
    <div className="cy-seat-form__actions"><span role="status">{saved ? text('工位配置已保存', 'Seat configuration saved') : ''}</span>
      <button type="submit" className="cy-console-button primary" disabled={busy || !draft.title.trim() || !draft.agentId}>
        {busy ? text('保存中…', 'Saving…') : text('保存工位配置', 'Save seat configuration')}</button></div>
  </form>;
}
