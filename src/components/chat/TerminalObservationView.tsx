import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatObservationElapsed } from './taskboard-observations';
import { renderTerminalLines, type TerminalChunk } from './terminal-output';
import { useLocale } from '../../i18n/LocaleContext';
import type { FrameworkErrorKind } from '../../api/error-contract';

type Scope = 'conversation' | 'cyclone';
type Status = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'crashed';
interface ObservationDetail {
  command: string;
  startedAt: number;
  finishedAt?: number;
  status: Status;
  exitCode?: number;
  error?: string;
  errorCode?: string;
  errorKind?: FrameworkErrorKind;
  outputTruncated?: boolean;
  output: TerminalChunk[];
}

export default function TerminalObservationView({ scope, ownerId, observationId, onBack }: {
  scope: Scope;
  ownerId: string;
  observationId: string;
  onBack: () => void;
}) {
  const { t } = useLocale();
  const [item, setItem] = useState<ObservationDetail | null>(null);
  const [error, setError] = useState('');
  const [following, setFollowing] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const outputRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const output = item ? renderTerminalLines(item.output) : [];

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const query = new URLSearchParams({ scope, ownerId });
      const response = await fetch(`/api/tools/observations/${encodeURIComponent(observationId)}?${query}`);
      if (!response.ok) throw new Error(t('chat.execution.readFailed'));
      const data = await response.json() as { item: ObservationDetail };
      if (!disposed) { setItem(data.item); setError(''); }
      return data.item.status;
    };
    const poll = async () => {
      try {
        const status = await load();
        if (!disposed && isActive(status)) window.setTimeout(poll, 750);
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
      }
    };
    void poll();
    return () => { disposed = true; };
  }, [scope, ownerId, observationId, t]);

  useLayoutEffect(() => {
    const element = outputRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [output]);

  useEffect(() => {
  if (!item || !isActive(item.status)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [item?.status]);

  const onScroll = () => {
    const element = outputRef.current;
    if (element) {
      const next = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      followRef.current = next;
      setFollowing(next);
    }
  };
  const backToBottom = () => {
    followRef.current = true;
    setFollowing(true);
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' });
  };
  const elapsed = item && formatObservationElapsed(item.startedAt, item.finishedAt ?? clock);
  const statusText = (status?: Status) => {
    if (status === 'cancelling') return t('chat.execution.stopping');
    if (status === 'completed') return t('chat.execution.completed');
    if (status === 'failed') return t('chat.execution.failed');
    if (status === 'cancelled') return t('chat.execution.cancelled');
    if (status === 'crashed') return t('chat.execution.crashed');
    return t('chat.execution.details');
  };
  const resultText = (detail: ObservationDetail) => {
    if (detail.status === 'cancelling') return t('chat.execution.terminatingChild');
    if (detail.status === 'running') return t('chat.execution.liveOutput');
    if (detail.error) return detail.error;
    return detail.exitCode === undefined ? statusText(detail.status) : t('chat.execution.exitCode', { code: detail.exitCode });
  };

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <button className="execution-surface-action" onClick={onBack} style={backStyle} title={t('chat.execution.back')}>{t('chat.execution.back')}</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={titleStyle}>{item?.status === 'running' ? t('chat.execution.running') : statusText(item?.status)}</div>
          <code style={commandStyle}>{item?.command ?? t('chat.execution.reading')}</code>
        </div>
        {elapsed && <span style={elapsedStyle}>{elapsed}</span>}
      </header>
      {item && <div style={resultStyle}>{resultText(item)}</div>}
      {error ? <div style={errorStyle}>{error}</div> : (
        <div style={outputWrapStyle}>
          <div ref={outputRef} onScroll={onScroll} style={outputStyle}>
            {item?.outputTruncated && <div style={truncatedStyle}>{t('chat.execution.truncated')}</div>}
            {output.length ? output.map((line, index) => <div key={index} style={line.stream === 'stderr' ? stderrLineStyle : undefined}>{line.text || ' '}</div>) : t('chat.execution.waitingOutput')}
          </div>
          {!following && <button onClick={backToBottom} style={bottomStyle}>{t('chat.execution.latestOutput')}</button>}
        </div>
      )}
    </div>
  );
}

function isActive(status: Status): boolean {
  return status === 'running' || status === 'cancelling';
}

const shellStyle: React.CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
const headerStyle: React.CSSProperties = { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-3)', borderBottom: '1px solid var(--glass-border)' };
const backStyle: React.CSSProperties = { appearance: 'none', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)', height: 25, padding: '0 var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-xs)' };
const titleStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', marginBottom: 2 };
const commandStyle: React.CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--color-text-primary)' };
const elapsedStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' };
const resultStyle: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', borderBottom: '1px solid var(--glass-border)' };
const errorStyle: React.CSSProperties = { margin: 'var(--space-3)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' };
const outputWrapStyle: React.CSSProperties = { flex: 1, minHeight: 0, position: 'relative', padding: 'var(--space-2)' };
const outputStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: '100%', margin: 0, overflow: 'auto', padding: 'var(--space-3)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', background: 'rgba(5, 15, 22, 0.72)', color: '#d7e4e8', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const truncatedStyle: React.CSSProperties = { marginBottom: 'var(--space-2)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid rgba(219, 172, 93, 0.25)', color: '#dbac5d', fontSize: '10px' };
const stderrLineStyle: React.CSSProperties = { color: '#eeaaa1' };
const bottomStyle: React.CSSProperties = { position: 'absolute', right: 'var(--space-4)', bottom: 'var(--space-4)', appearance: 'none', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg-strong)', color: 'var(--color-text-secondary)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-xs)' };
