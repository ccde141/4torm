import { useState } from 'react';

/**
 * ContactCard — 气旋工位间联络卡片
 *
 * 视觉对齐季风：无 avatar，缩进 + 左边色条 + 圆形状态图标，折叠/展开。
 * 区别于 delegate（状态色竖条）/ ask（紫竖条）：contact 用蓝竖条 #3b82f6，
 * 语义是"对其他工位发起联络"，折叠看标题，展开看发出消息 + 对方回复全文。
 */
export interface ContactCardData {
  target: string;
  message: string;
  reply?: string;
  status: 'running' | 'success' | 'error';
}

const BLUE = '#3b82f6';

export default function ContactCard({ data }: { data: ContactCardData }) {
  const [expanded, setExpanded] = useState(false);
  const { target, message, reply, status } = data;

  const icon = status === 'success' ? '\u2713' : status === 'error' ? '\u2717' : '\u25cc';
  const subtitle = status === 'running' ? '联络中...' : status === 'error' ? '联络失败' : '已回复';

  return (
    <div className="chat__message chat__message--assistant" style={{ paddingLeft: '24px' }}>
      <div className="chat__bubble" style={{
        minWidth: '280px', maxWidth: '600px',
        border: '1px solid var(--glass-border)',
        borderLeft: `3px solid ${BLUE}`,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--glass-blur))',
        borderRadius: 'var(--border-radius-md)',
        padding: 0, overflow: 'hidden',
      }}>
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          cursor: 'pointer', userSelect: 'none',
          appearance: 'none', border: 'none', background: 'none',
          font: 'inherit', color: 'inherit',
          padding: 'var(--space-3) var(--space-4)', width: '100%', textAlign: 'left',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', borderRadius: '50%',
            background: `${BLUE}20`, color: BLUE,
            fontSize: '11px', fontWeight: 'bold', flexShrink: 0,
          }}>
            {status === 'running' ? <span style={{ animation: 'spin 1.5s linear infinite' }}>{icon}</span> : icon}
          </span>
          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            联络 → {target}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginRight: 'var(--space-2)' }}>
            {subtitle}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            {'\u25b6'}
          </span>
        </button>

        {!expanded && reply && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {reply.slice(0, 120)}{reply.length > 120 ? '\u2026' : ''}
          </div>
        )}

        {expanded && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>发出</div>
              <pre style={preStyle}>{message}</pre>
            </div>
            {reply && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>{target} 回复 {icon}</div>
                <pre style={preStyle}>{reply}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap',
  maxHeight: '300px', overflow: 'auto',
};
