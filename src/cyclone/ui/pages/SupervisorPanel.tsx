import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../../../types';
import { useConsoleText } from '../console/console-text';
import SeatChat from './SeatChat';
import { configureSupervisor, readSupervisor, SUPERVISOR_STREAM_KEY, type SupervisorStatus } from './supervisor-client';
import type { SeatStreamRunners } from './useSeatStreamRunners';
import './supervisor-panel.css';

export function SupervisorPanel({ workshopId, agents, runners, active, onChanged }: {
  workshopId: string; agents: Agent[]; runners: SeatStreamRunners; active: boolean; onChanged(): void;
}) {
  const text = useConsoleText();
  const [status, setStatus] = useState<SupervisorStatus | null>(null);
  const [agentId, setAgentId] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tokenContainer, setTokenContainer] = useState<HTMLSpanElement | null>(null);
  const [, tick] = useState(0);
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => runners.subscribe(SUPERVISOR_STREAM_KEY, () => tick(value => value + 1)), [runners]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void readSupervisor(workshopId, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setStatus(next); setError('');
      if (!dirty.current) { setAgentId(next.agentId ?? ''); setRolePrompt(next.rolePrompt); }
      if (!next.configured) setSettings(true);
    }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [active, workshopId]);
  const running = !!runners.getRunner(SUPERVISOR_STREAM_KEY)?.streaming;
  const boundAgent = agents.find(agent => agent.id === status?.agentId);
  async function save() {
    if (!agentId || saving || running) return;
    setSaving(true); setError('');
    try {
      const next = await configureSupervisor(workshopId, agentId, rolePrompt);
      if (!mounted.current) return;
      dirty.current = false; setStatus(next); setSettings(false); onChanged();
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setSaving(false); }
  }
  return <section className="cyclone-supervisor" aria-label={text('工作室主管', 'Workshop supervisor')}>
    <header className="cyclone-supervisor__header">
      <span className="cyclone-supervisor__symbol" aria-hidden="true">◇</span>
      <div className="cyclone-supervisor__identity"><h2>{text('工作室主管', 'Workshop supervisor')}</h2>
        <span>{boundAgent?.name ?? (status?.configured ? status.agentId : text('尚未配置', 'Not configured'))}</span></div>
      <span ref={setTokenContainer} style={{ display: 'inline-flex', flexShrink: 0 }} />
      {running && <span className="cyclone-sidebar-status cyclone-sidebar-status--running"
        aria-label={text('运行中', 'Running')}>•</span>}
      <button type="button" className="secondary-action-btn" aria-expanded={settings}
        onClick={() => setSettings(value => !value)}>{text('配置', 'Configure')}</button>
    </header>
    {error && <p role="alert" className="agent-detail__error">{error}</p>}
    {settings && <form className="cyclone-supervisor__config" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>{text('绑定 Agent', 'Agent')}<select value={agentId} disabled={saving || running}
        onChange={event => { dirty.current = true; setAgentId(event.target.value); }} required>
        <option value="">{text('选择 Agent', 'Select an Agent')}</option>
        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
      </select></label>
      <label>{text('主管提示词', 'Supervisor prompt')}<textarea value={rolePrompt} rows={4}
        disabled={saving || running} onChange={event => { dirty.current = true; setRolePrompt(event.target.value); }} /></label>
      <div className="cyclone-supervisor__actions"><button type="submit" className="primary-cta-btn"
        disabled={!agentId || saving || running}>{saving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button>
        {status?.configured && <button type="button" className="secondary-action-btn" onClick={() => {
          dirty.current = false; setAgentId(status.agentId ?? ''); setRolePrompt(status.rolePrompt); setSettings(false);
        }}>{text('取消', 'Cancel')}</button>}</div>
    </form>}
    {status?.configured ? <SeatChat key={workshopId} workshopId={workshopId} seatId={SUPERVISOR_STREAM_KEY}
      runners={runners} active={active} tokenContainer={tokenContainer} onReloaded={onChanged} />
      : !status && !error ? <p className="cyclone-supervisor__empty">{text('正在读取主管…', 'Loading supervisor…')}</p> : null}
  </section>;
}
