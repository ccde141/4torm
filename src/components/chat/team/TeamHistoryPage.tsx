import { useEffect, useRef, useState } from 'react';
import { backendFetch } from '../../../lib/backend-client';
import type { en } from './messages';
import type { TeamMember, TeamReport, TeamSnapshot } from './types';

export function TeamHistoryPage({ agentId, sessionId, w, onSelect }: {
  agentId: string; sessionId: string; w: typeof en;
  onSelect(member: TeamMember, reports: TeamReport[], revision: number): void;
}) {
  const [page, setPage] = useState<TeamSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function read(previous: TeamSnapshot | null) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    try {
      const response = await backendFetch('/api/collaboration/invoke', {
        method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: 'monsoon', method: 'getTeam',
          input: { agentId, sessionId, view: 'dismissed',
            ...(previous ? { cursor: previous.nextCursor } : {}) },
          budget: { items: 20, textChars: 20_000 } }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body.includes('TEAM_REVISION_CONFLICT') ? w.historyChanged : `HTTP ${response.status}`);
      }
      const next: TeamSnapshot = await response.json();
      if (!request.signal.aborted) setPage(previous ? { ...next,
        members: [...previous.members, ...next.members], reports: [...previous.reports, ...next.reports] } : next);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (!request.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    void read(null);
    return () => controller.current?.abort();
    // The page owns its snapshot; refresh and pagination are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId]);
  const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString() : w.unrecorded;
  return <section className="session-team-history" aria-label={w.dismissedMembers}>
    <header><strong>{w.dismissedMembers} · {page?.total ?? '—'}</strong>
      <button disabled={loading} onClick={() => void read(null)}>{w.refresh}</button></header>
    {error && <p role="alert">{error}</p>}
    {!page && loading && <p>{w.loading}</p>}
    {page?.members.length === 0 && <p>{w.noDismissed}</p>}
    {page?.members.map(member => <button key={member.id} className="session-team-history-row"
      onClick={() => onSelect(member, page.reports.filter(report => report.memberId === member.id), page.revision)}>
      <strong>{member.name}</strong><span>{member.mission}</span>
      <small>{w.recruitedAt} · {timestamp(member.recruitedAt)}</small>
      <small>{w.dismissedAt} · {timestamp(member.dismissedAt)}</small>
      <span className="session-team-history-context">{w.transcript} ↗</span>
    </button>)}
    {page?.nextCursor && <button disabled={loading} onClick={() => void read(page)}>
      {loading ? w.loading : w.loadMore}</button>}
  </section>;
}
