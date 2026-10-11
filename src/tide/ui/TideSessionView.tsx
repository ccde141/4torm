import { useEffect, useRef, useState } from 'react';
import { compactTideSession, type TideSession } from '../../api/tide';
import StructuredMessage from '../../components/chat/StructuredMessage';
import { useLocale } from '../../i18n/LocaleContext';
import { actionBtnStyle } from './tide-styles';
import { formatTideContextTokens } from './tide-token-label';
import { CompactionNotice } from '../../components/common/CompactionNotice';
import { visibleTideMessages } from './tide-session-projection';

interface TideSessionViewProps {
  session: TideSession;
  onClose: () => void;
  onCompacted?: () => Promise<unknown>;
}

export default function TideSessionView({ session, onClose, onCompacted }: TideSessionViewProps) {
  const { locale, t } = useLocale();
  const [compacting, setCompacting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const identity = `${session.agentId}:${session.id}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => { setNotice(''); setError(''); setCompacting(false); }, [identity]);
  const messages = visibleTideMessages(session);
  const compact = async () => {
    setCompacting(true); setError(''); setNotice('');
    try {
      const result = await compactTideSession(session.agentId, session.id);
      if (currentIdentity.current !== identity) return;
      setNotice(result.notices.join('\n'));
      await onCompacted?.();
    } catch (cause) { if (currentIdentity.current === identity) setError((cause as Error).message); }
    finally { if (currentIdentity.current === identity) setCompacting(false); }
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{session.title}</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => void compact()} disabled={compacting || messages.length === 0} style={actionBtnStyle}>
            {compacting ? (locale === 'en-US' ? 'Compacting…' : '正在压缩…')
              : (locale === 'en-US' ? 'Compact session' : '压缩会话')}
          </button>
          <button onClick={onClose} style={actionBtnStyle}>{t('tide.session.close')}</button>
        </div>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-6)', textAlign: 'center', textShadow: 'var(--text-halo)' }}>
        {t('tide.session.messageCount', { count: messages.length, model: session.model })}
        <span title={locale === 'en-US'
          ? 'Provider-reported input tokens for the latest model request'
          : '最近一次模型请求的输入 token 数，由提供商回报'}>
          {' · '}{formatTideContextTokens(session.tokenUsage, locale)}{session.tokenUsage ? ' tokens' : ''}
        </span>
      </div>
      <div className="chat__messages">
        {notice && <CompactionNotice message={notice} />}
        {error && <p role="alert" className="agent-detail__error">{error}</p>}
        {messages.map(message => {
          if (message.role === 'tool-call') return <ToolCallBubble key={message.id} content={message.content} timestamp={message.timestamp} />;
          if (message.role === 'tool-result') return <ToolResultBubble key={message.id} content={message.content} timestamp={message.timestamp} />;
          if (message.role === 'assistant') {
            return <StructuredMessage key={message.id} tools={[]} answer={message.content} msgId={message.id} timestamp={message.timestamp} />;
          }
          return (
            <div key={message.id} className="chat__message chat__message--user">
              <div className="chat__avatar" aria-label={t('tide.session.pushAvatarLabel')}>
                {t('tide.session.pushAvatar')}
              </div>
              <div className="chat__bubble">
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{message.content}</div>
                {message.timestamp && <div className="chat__timestamp" title={message.timestamp}>{message.timestamp.slice(0, 19).replace('T', ' ')}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolCallBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  let parsed: { tool: string; args: Record<string, string> } = { tool: '?', args: {} };
  try { parsed = JSON.parse(content); } catch {}
  return (
    <div style={{ margin: '8px 0 8px 36px', padding: '8px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', fontSize: 'var(--text-xs)' }}>
      <div style={{ color: '#3b82f6', fontWeight: 'var(--font-medium)', marginBottom: '4px' }}>→ {parsed.tool}</div>
      {Object.keys(parsed.args).length > 0 && <pre style={{ margin: 0, fontSize: '10px', color: 'var(--color-text-tertiary)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)' }}>{JSON.stringify(parsed.args, null, 2)}</pre>}
      {timestamp && <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{timestamp.slice(11, 19)}</div>}
    </div>
  );
}

function ToolResultBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  let parsed: { tool: string; result: string; ok: boolean } = { tool: '?', result: '', ok: true };
  try { parsed = JSON.parse(content); } catch {}
  const color = parsed.ok ? '#22c55e' : '#ef4444';
  return (
    <div style={{ margin: '4px 0 12px 36px', padding: '8px 12px', background: parsed.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${parsed.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: '6px', fontSize: 'var(--text-xs)' }}>
      <div style={{ color, fontWeight: 'var(--font-medium)', marginBottom: '4px' }}>{parsed.ok ? '←' : '✗'} {parsed.tool}</div>
      <pre style={{ margin: 0, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', maxHeight: '200px', overflow: 'auto' }}>
        {parsed.result.slice(0, 1500)}{parsed.result.length > 1500 ? '\n…' : ''}
      </pre>
      {timestamp && <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{timestamp.slice(11, 19)}</div>}
    </div>
  );
}
