import { backendFetch } from '../../../lib/backend-client';
import BoundedText from '../../../engine/text-display/BoundedText';
import { useEffect, useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import type { en } from './messages';
import { memberStatus, reportStatus, type TeamContextMessage, type TeamMember, type TeamReport } from './types';

type Words = typeof en;
export function ReportHistory({ reports, w }: { reports: TeamReport[]; w: Words }) {
  return <div className="session-team-timeline">
    {!reports.length && <p>{w.noReports}</p>}
    {[...reports].reverse().map(report => <article key={report.id} className="session-team-exchange">
      <small>{w[reportStatus(report)]}</small>
      <details><summary>{w.dispatch}</summary><p><BoundedText text={report.task} /></p></details>
      <details open={reports.at(-1)?.id === report.id}>
        <summary>{w.reply} · {w[reportStatus(report)]}</summary>
        <small>{w.execution} · {w[report.outcome as keyof Words] ?? report.outcome}</small><div className="session-team-markdown">{renderTextWithCode(report.content)}</div>
      </details>
      {report.review && <details className="session-team-verdict"><summary>{w.review}</summary><p>{report.review.reason}</p></details>}
    </article>)}
  </div>;
}

function MemberTranscript({ agentId, sessionId, memberId, revision, w }: {
  agentId: string; sessionId: string; memberId: string; revision: number; w: Words;
}) {
  const [messages, setMessages] = useState<TeamContextMessage[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ agentId, sessionId, memberId });
    void backendFetch(`/api/conversation/team/context?${params}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const body: { messages: TeamContextMessage[] } = await response.json();
      if (!controller.signal.aborted) { setMessages(body.messages); setError(''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [agentId, sessionId, memberId, revision]);
  const visible = messages?.filter(message => JSON.stringify(message).toLowerCase().includes(query.toLowerCase()));
  return <section className="session-team-transcript">
    <small>{w.contextHint}</small>
    <input aria-label={w.search} placeholder={w.search} value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p role="alert">{error}</p>}
    {!messages && !error && <p>{w.loading}</p>}
    {visible?.length === 0 && <p>{w.noContext}</p>}
    {visible?.map((message, index) => <article key={index} className={`session-team-message is-${message.role}`}>
      {message.role === 'assistant' && message.content && <><small>{w.assistant}</small><div className="session-team-markdown">{renderTextWithCode(message.content)}</div></>}
      {message.role !== 'assistant' && <details open={query.trim() ? true : undefined}>
        <summary>{w[message.role]}<span className="session-team-preview">{message.content.replace(/\s+/g, ' ').slice(0, 100)}</span></summary>
        <p><BoundedText text={message.content} /></p>
      </details>}
      {message.toolCalls?.map(call => <details key={call.id}><summary>{call.name}</summary><pre><BoundedText text={(call.arguments) ?? ''} /></pre></details>)}
    </article>)}
  </section>;
}

export function MemberInspector({ member, reports, agentId, sessionId, revision, w, initialTab = 'activity' }: {
  member: TeamMember; reports: TeamReport[]; agentId: string; sessionId: string; revision: number; w: Words;
  initialTab?: 'activity' | 'transcript' | 'configuration';
}) {
  const [tab, setTab] = useState(initialTab);
  return <>
    <h3>{member.name}</h3><span className="session-team-status">{w[memberStatus(member, reports)]}</span>
    <details className="session-team-mission"><summary>{w.mission}</summary><p>{member.mission}</p></details>
    <nav className="session-team-tabs" aria-label={member.name}>
      {(['activity', 'transcript', 'configuration'] as const).map(key =>
        <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{w[key]}</button>)}
    </nav>
    <div key={tab} className="session-team-tab-content">
    {tab === 'activity' && <>
      {member.run?.status === 'running' && <details className="session-team-exchange"><summary>{w.dispatch} · {w.running}</summary><p>{member.run.task}</p></details>}
      <ReportHistory reports={reports} w={w} />
    </>}
    {tab === 'transcript' && <MemberTranscript key={`${agentId}:${sessionId}:${member.id}`} agentId={agentId} sessionId={sessionId} memberId={member.id} revision={revision} w={w} />}
    {tab === 'configuration' && (['rolePrompt', 'taskContext', 'constraints'] as const).map((field, index) =>
      <section key={field}><h4>{[w.role, w.context, w.constraints][index]}</h4><p>{member[field] || '—'}</p></section>)}
    </div>
  </>;
}
