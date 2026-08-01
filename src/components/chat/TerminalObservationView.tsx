import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatObservationElapsed } from './taskboard-observations';
import { renderTerminalLines, type TerminalChunk } from './terminal-output';

type Scope = 'conversation' | 'cyclone';
type Status = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'crashed';
interface ObservationDetail {
  command: string;
  startedAt: number;
  finishedAt?: number;
  status: Status;
  exitCode?: number;
  error?: string;
  outputTruncated?: boolean;
  output: TerminalChunk[];
}

export default function TerminalObservationView({ scope, ownerId, observationId, onBack }: {
  scope: Scope;
  ownerId: string;
  observationId: string;
  onBack: () => void;
}) {
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
      if (!response.ok) throw new Error('无法读取运行详情');
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
  }, [scope, ownerId, observationId]);

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

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <button className="execution-surface-action" onClick={onBack} style={backStyle} title="返回任务板">返回任务板</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={titleStyle}>{item?.status === 'running' ? '正在执行' : observationStatus(item?.status)}</div>
          <code style={commandStyle}>{item?.command ?? '正在读取运行详情...'}</code>
        </div>
        {elapsed && <span style={elapsedStyle}>{elapsed}</span>}
      </header>
      {item && <div style={resultStyle}>{resultText(item)}</div>}
      {error ? <div style={errorStyle}>{error}</div> : (
        <div style={outputWrapStyle}>
          <div ref={outputRef} onScroll={onScroll} style={outputStyle}>
            {item?.outputTruncated && <div style={truncatedStyle}>较早输出已折叠</div>}
            {output.length ? output.map((line, index) => <div key={index} style={line.stream === 'stderr' ? stderrLineStyle : undefined}>{line.text || ' '}</div>) : '等待命令输出...'}
          </div>
          {!following && <button onClick={backToBottom} style={bottomStyle}>最新输出</button>}
        </div>
      )}
    </div>
  );
}

function isActive(status: Status): boolean {
  return status === 'running' || status === 'cancelling';
}

function observationStatus(status?: Status): string {
  if (status === 'cancelling') return '正在停止';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '执行失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'crashed') return '异常中断';
  return '运行详情';
}

function resultText(item: ObservationDetail): string {
  if (item.status === 'cancelling') return '正在终止子进程…';
  if (item.status === 'running') return '输出实时更新中';
  if (item.error) return item.error;
  return item.exitCode === undefined ? observationStatus(item.status) : `退出码 ${item.exitCode}`;
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
