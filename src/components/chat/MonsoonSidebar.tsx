import { SYSTEM_STATUSES } from '../../store/statuses';
import { formatTokenUsage } from '../../store/chat-token';
import type { Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import { useLocale } from '../../i18n/LocaleContext';
import { PresenceItems } from '../common/PresenceItems';
import { sessionUsageKey, type SessionUsageDisplay } from './session-list-state';

const statusColors = Object.fromEntries(SYSTEM_STATUSES.map(status => [status.id, status.color]));

export interface MonsoonSidebarProps {
  agents: Agent[];
  offlineIds: Set<string>;
  selectedAgent: Agent | null;
  sessions: ChatSession[];
  displayUsage?: SessionUsageDisplay;
  activeSessionId: string | null;
  selectAgent(agent: Agent): void;
  selectSession(sessionId: string): void;
  newSession(): void;
  deleteSession(session: ChatSession): void;
}

export function MonsoonSidebar(props: MonsoonSidebarProps) {
  const { t, locale } = useLocale();
  return <aside style={panelStyle}>
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={labelStyle}>Agent</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {props.agents.map(agent => <button key={agent.id} onClick={() => props.selectAgent(agent)}
          style={agentStyle(agent.id === props.selectedAgent?.id)}>
          <span style={dotStyle(props.offlineIds.has(agent.id) ? '#ef4444'
            : agent.busy ? statusColors.busy : statusColors[agent.status] ?? statusColors.idle)}
            title={props.offlineIds.has(agent.id) ? t('chat.page.offline')
              : agent.busy ? t('chat.page.busy') : agent.status === 'idle'
                ? t('chat.page.idle') : agent.status} />
          <span className="text-truncate">{agent.name}</span>
        </button>)}
      </div>
    </div>
    {props.selectedAgent ? <>
      <div style={sessionHeadingStyle}>
        <div style={labelStyle}>{t('chat.page.sessions')}</div>
        <button onClick={() => props.newSession()} className="icon-add-btn"
          title={t('chat.page.newSession')} aria-label={t('chat.page.newSession')}>+</button>
      </div>
      <div className="session-list" style={{ flex: 1, overflowY: 'auto' }}>
        {!props.sessions.length && <div style={emptyListStyle}>{t('chat.page.noSessions')}</div>}
        <PresenceItems key={props.selectedAgent.id} items={props.sessions}
          getKey={session => session.id} scope="sessions" render={session => {
          const unread = props.activeSessionId === session.id ? 0 : session.unreadCount ?? 0;
          const tokens = formatTokenUsage(props.displayUsage
            ? props.displayUsage[sessionUsageKey(session)] : session.tokenUsage, locale);
          return <div style={{ position: 'relative' }}>
            <div className={`session-item${props.activeSessionId === session.id ? ' session-item--active' : ''}`}
              role="button" tabIndex={0} aria-current={props.activeSessionId === session.id ? 'true' : undefined}
              onClick={() => props.selectSession(session.id)}
              onKeyDown={event => activate(event, () => props.selectSession(session.id))}>
              <div className="session-item__title"><span className="text-truncate" style={{ maxWidth: 140 }}>{session.title}</span>
                {unread > 0 && <span className="session-item__unread">{unread}</span>}</div>
              <div className="session-item__meta"><span className="text-truncate" style={{ maxWidth: 120 }}>{session.id}</span>
                <span className="session-item__tokens" title={tokens.title}>{tokens.label}</span></div>
            </div>
            <button onClick={event => { event.stopPropagation(); props.deleteSession(session); }}
              style={deleteStyle} title={t('chat.page.deleteSession')}>x</button>
          </div>;
        }} />
      </div>
    </> : <div style={emptyListStyle}>{t('chat.page.selectAgent')}</div>}
  </aside>;
}

function activate(event: React.KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
}

function agentStyle(active: boolean): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', width: '100%',
    background: active ? 'var(--color-accent-subtle)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    fontWeight: active ? 'var(--font-semibold)' : 'var(--font-normal)',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--border-color)'}` };
}

const panelStyle: React.CSSProperties = { width: 280, borderRight: '1px solid var(--border-color)',
  padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column',
  background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))' };
const labelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)',
  marginBottom: 'var(--space-1)' };
const sessionHeadingStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 'var(--space-2)' };
const emptyListStyle: React.CSSProperties = { padding: 'var(--space-4)', color: 'var(--color-text-tertiary)',
  fontSize: 'var(--text-sm)', textAlign: 'center', textShadow: 'var(--text-halo)' };
const deleteStyle: React.CSSProperties = { position: 'absolute', top: 4, right: 4, width: 20, height: 20,
  display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent',
  color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' };
function dotStyle(color: string): React.CSSProperties {
  return { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 };
}
