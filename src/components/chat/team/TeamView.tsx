import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import { en, zh } from './messages';
import { memberStatus } from './types';
import { MemberInspector, ReportHistory } from './MemberInspector';
import { useTeam } from './useTeam';
import './team.css';
import { TeamConnections } from './TeamConnections';
import { TeamSummary } from './TeamSummary';
import { summarizeTeam } from './summary';

export interface TeamViewProps { agentId: string; sessionId: string; mainName: string; mainBusy: boolean }
export default function TeamView(props: TeamViewProps) {
  const { locale } = useLocale();
  const words = locale === 'en-US' ? en : zh;
  const [open, setOpen] = useState(false);
  const [initialMember, setInitialMember] = useState<string>();
  const team = useTeam(props.agentId, props.sessionId, props.mainBusy);
  return <>
    <TeamSummary {...team} busy={props.mainBusy} mainName={props.mainName} w={words} onOpen={id => { setInitialMember(id); setOpen(true); }} />
    {open && <TeamDialog key={`${props.agentId}:${props.sessionId}`} {...props} team={team} initialMember={initialMember} onClose={() => setOpen(false)} />}
  </>;
}

function TeamDialog({ agentId, sessionId, mainName, mainBusy, onClose, team, initialMember }: TeamViewProps & { onClose: () => void; team: ReturnType<typeof useTeam>; initialMember?: string }) {
  const { locale } = useLocale();
  const w = locale === 'en-US' ? en : zh;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const { data, error, reload } = team;
  const [selectedId, select] = useState<string | undefined>(initialMember);
  const counts = summarizeTeam(data);
  const selected = data?.members.find(member => member.id === selectedId);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="session-team" onCancel={onClose} aria-label={w.title}>
    <header><div><strong>{w.title}</strong><small>{error ? w.unavailable : !data ? w.loading : `${counts.running} ${w.running} · ${counts.pending} ${w.pending} · ${w.main} ${mainBusy ? w.running : w.idle}`}</small></div>
      <button onClick={reload}>{w.refresh}</button><button onClick={onClose}>{w.close} ×</button></header>
    {error && <p role="alert" className="session-team-error">{error}</p>}
    {data?.truncated && <p role="status" className="session-team-error">{w.partial}</p>}
    <div className="session-team-body">
      <section className="session-team-map" aria-label={w.title}>
        <div className="session-team-canvas" ref={canvas}>
        <TeamConnections canvas={canvas} revision={`${data?.revision}:${selectedId}:${mainBusy}`} />
        <button onClick={() => select(undefined)} className={`session-team-node session-team-main ${mainBusy ? 'is-running' : ''}`}>
          <small>{w.main}</small><strong>{mainName}</strong><span>● {mainBusy ? w.running : w.idle}</span>
        </button>
        {!data && !error && <p>{w.loading}</p>}
        {data?.members.length === 0 && <div className="session-team-empty"><strong>{w.empty}</strong><p>{w.hint}</p></div>}
        {!!data?.members.length && <div className="session-team-branches">
          {data.members.map(member => <div className="session-team-branch" key={member.id}>
            <button className={`session-team-node is-${memberStatus(member, data.reports)} ${selectedId === member.id ? 'is-selected' : ''}`}
              data-member={member.id} data-running={member.run?.status === 'running'}
              aria-pressed={selectedId === member.id} onClick={() => select(member.id)}>
              <small>{w.assistant} · {member.lifecycle === 'dismissed' ? w.dismissed : member.run?.status === 'running' ? w.running : w.idle}</small>
              <strong>{member.name}</strong>
              <span className="session-team-last-result">{w.task}<b>{w[memberStatus(member, data.reports)]}</b></span>
            </button>
          </div>)}
        </div>}
        </div>
      </section>
      <aside className="session-team-inspector">
        <div key={selected?.id ?? 'overview'} className="session-team-selection-content">
        {selected ? <MemberInspector key={selected.id} agentId={agentId} sessionId={sessionId} revision={data!.revision}
          member={selected} reports={data!.reports.filter(item => item.memberId === selected.id)} w={w} />
          : <><h3>{w.overview}</h3><p>{mainName} · {mainBusy ? w.running : w.idle}</p>
            <div className="session-team-counts"><strong>{data?.members.filter(member => member.lifecycle === 'active').length ?? 0}<small>{w.title}</small></strong>
              <strong>{data?.members.filter(member => member.run?.status === 'running').length ?? 0}<small>{w.running}</small></strong>
              <strong>{data?.reports.filter(report => !report.acknowledged).length ?? 0}<small>{w.pending}</small></strong></div>
            <p>{w.select}</p><h4>{w.activity}</h4><ReportHistory reports={data?.reports ?? []} w={w} /></>}
        </div>
      </aside>
    </div><footer>{w.note}</footer>
  </dialog>;
}
