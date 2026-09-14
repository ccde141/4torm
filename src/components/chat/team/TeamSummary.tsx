import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TeamSnapshot } from './types';
import { TeamPreviewGraph } from './TeamPreviewGraph';
import { summarizeTeam } from './summary';
import type { en } from './messages';
function usePreview(onOpen: (id?: string) => void) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 520 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const show = () => {
    clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.right - 580, window.innerWidth - 592)), top: rect.bottom + 6, maxHeight: Math.max(80, window.innerHeight - rect.bottom - 18) });
    setExpanded(true);
  };
  const leave = () => { timer.current = setTimeout(() => setExpanded(false), 140); };
  const open = (memberId?: string) => { clearTimeout(timer.current); setExpanded(false); onOpen(memberId); };
  useEffect(() => {
    const hide = () => setExpanded(false);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('resize', hide); window.addEventListener('keydown', key);
    return () => { clearTimeout(timer.current); window.removeEventListener('resize', hide); window.removeEventListener('keydown', key); };
  }, []);
  const blur = (event: React.FocusEvent) => {
    if (!popup.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) leave();
  };
  return { expanded, position, trigger, popup, timer, id, show, leave, open, blur };
}
export function TeamSummary({ data, error, busy, mainName, w, onOpen, reload }: {
  data: TeamSnapshot | null; error: string; busy: boolean; mainName: string; w: typeof en;
  onOpen: (id?: string) => void; reload: () => void;
}) {
  const { expanded, position, trigger, popup, timer, id, show, leave, open, blur } = usePreview(onOpen);
  const counts = summarizeTeam(data);
  return <>
    <button ref={trigger} className="team-collaboration-trigger session-team-entry" aria-haspopup="dialog" aria-describedby={expanded ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={blur} onClick={() => open()}>
      <span aria-hidden="true">♧</span>{w.collaboration}{counts.running > 0 && <i aria-label={`${counts.running} ${w.running}`}>{counts.running}</i>}
    </button>
    {expanded && createPortal(<div id={id} ref={popup} className="team-summary team-summary-popover" style={position} role="region" aria-label={w.overview}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave} onFocus={() => clearTimeout(timer.current)} onBlur={blur}>
      <div className="team-summary-heading"><strong>{w.overview}</strong><small>{error ? w.unavailable : !data ? w.loading : `${counts.running} ${w.running} · ${counts.pending} ${w.pending}`}</small></div>
      <div className="team-summary-content">
      {error && <p role="alert">{error} <button onClick={reload}>{w.refresh}</button></p>}
      {!error && data?.members.length === 0 && <p>{w.hint}</p>}
      {!error && data && <TeamPreviewGraph data={data} busy={busy} mainName={mainName} w={w} open={open} />}
      </div>
      <button className="team-preview-open" onClick={() => open()}>{w.open} ↗</button>
    </div>, document.body)}
  </>;
}
