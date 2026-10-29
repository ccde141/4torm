import BoundedText from '../../engine/text-display/BoundedText';
import type { TideSession } from '../../api/tide';
import StructuredMessage from '../../components/chat/StructuredMessage';
import { useLocale } from '../../i18n/LocaleContext';
import { formatTideContextTokens, useTideUsage } from './tide-token-label';
import { CompactionNotice } from '../../components/common/CompactionNotice';
import { CompactionStatus } from '../../components/common/CompactionStatus';
import { CompactionHistory } from '../../components/common/CompactionHistory';
import { isCompactionHistory } from '../../components/common/compaction-history';
import { visibleTideMessages } from './tide-session-projection';
import { useTideCompaction } from './use-tide-compaction';
import TideIcon from './TideIcon';
import { formatTimestamp } from '../../utils/time';
import ToolResultImages from '../../components/common/ToolResultImages';
import type { ToolImageRef, ToolMediaScope } from '../../engine/tool-media';
import { formatCurrentInput, formatModelUsage } from '../../lib/model-usage';

interface TideSessionViewProps {
  session: TideSession;
  running?: boolean;
  onClose: () => void;
  onCompacted?: () => Promise<unknown>;
}

export default function TideSessionView({ session, running = false, onClose, onCompacted }: TideSessionViewProps) {
  const { locale, t } = useLocale();
  const { compact, cancel, compacting, notice, activity } = useTideCompaction(session, onCompacted,
    locale === 'en-US');
  const messages = visibleTideMessages(session);
  const tokenUsage = useTideUsage(`${session.agentId}:${session.id}`, session.tokenUsage,
    running || compacting || activity?.phase === 'running');
  const liveUsage = session.usage?.modelUsage;
  const activeRequest = liveUsage?.latest && ['prepared', 'sent', 'streaming'].includes(liveUsage.latest.state);
  const metering = formatCurrentInput(session.currentInput, locale, liveUsage)
    ?? (activeRequest ? formatModelUsage(liveUsage, locale, tokenUsage) : undefined)
    ?? (tokenUsage && messages.length ? { label: formatTideContextTokens(tokenUsage, locale),
      title: locale === 'en-US' ? 'Last reported request input; the current context estimate is unavailable.'
        : '上次请求的实测输入；当前上下文预估尚不可用。' } : undefined);
  return (
    <section className="tide-session" aria-label={t('tide.session.title')}>
      <header className="tide-session__header">
        <div className="tide-session__heading">
          <div className="tide-session__symbol"><TideIcon name="message" /></div>
          <div className="tide-session__heading-text">
            <span className="tide-session__eyebrow">{t('tide.session.title')}</span>
            <h2>{session.title}</h2>
          </div>
          {running && <span className="tide-session__running"><i />{t('tide.task.status.executing')}</span>}
        </div>
        <div className="tide-session__actions">
          <button className="tide-session__button" onClick={() => void compact()}
            disabled={compacting || activity?.phase === 'running' || messages.length === 0}>
            <TideIcon name="repeat" />
            {t(compacting ? 'tide.session.compacting' : 'tide.session.compact')}
          </button>
          {compacting && <button className="tide-session__button tide-session__button--danger" onClick={cancel}>
            <TideIcon name="stop" />{t('tide.session.stopCompaction')}
          </button>}
          <button className="tide-session__button" onClick={onClose}>
            <TideIcon name="arrow-left" />{t('tide.session.close')}
          </button>
        </div>
        <div className="tide-session__meta">
          {session.agentName && <span className="tide-session__agent">{session.agentName}</span>}
          <span>{t('tide.session.messageCount', { count: messages.length, model: session.model })}</span>
          <span className="tide-session__usage" title={metering?.title ?? t('tide.session.usageHint')}>
            {metering?.label ?? '—'}{metering ? ' tokens' : ''}
          </span>
        </div>
      </header>
      <CompactionStatus activity={activity} />
      {(notice || session.compactionNotice) && <CompactionNotice message={notice || session.compactionNotice!} />}
      <div className="tide-session__messages chat__messages">
        {messages.length === 0 && <div className="tide-session__empty"><TideIcon name="message" />{t('tide.session.empty')}</div>}
        {messages.map(message => {
          if (message.role === 'system' && (message.type === 'compact-marker' || isCompactionHistory(message.content))) {
            return <CompactionHistory key={message.id} content={message.content} handoff />;
          }
          if (message.role === 'system') return <div key={message.id} className="chat__message chat__message--system">
            <div className="chat__avatar">S</div>
            <div className="chat__bubble"><BoundedText text={message.content} /></div>
          </div>;
          if (message.role === 'tool-call') return <ToolCallBubble key={message.id} content={message.content} timestamp={message.timestamp} />;
          if (message.role === 'tool-result') return <ToolResultBubble key={message.id} content={message.content} timestamp={message.timestamp}
            toolImages={message.toolImages} mediaScope={{ feature: 'tide', agentId: session.agentId, sessionId: session.id }} />;
          if (message.role === 'assistant') {
            return <StructuredMessage key={message.id} tools={[]} answer={message.content} msgId={message.id} timestamp={message.timestamp} />;
          }
          return (
            <div key={message.id} className="chat__message chat__message--user">
              <div className="chat__avatar" aria-label={t('tide.session.pushAvatarLabel')}>
                <TideIcon name="arrow" />
              </div>
              <div className="chat__bubble">
                <div className="tide-session__push-content"><BoundedText text={message.content} /></div>
                {message.timestamp && <div className="chat__timestamp" title={formatTimestamp(message.timestamp, true)}>{formatTimestamp(message.timestamp)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ToolCallBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  const { t } = useLocale();
  let parsed: { tool: string; args: unknown } = { tool: '?', args: content };
  try {
    const value: unknown = JSON.parse(content);
    if (value && typeof value === 'object' && 'tool' in value && typeof value.tool === 'string') {
      parsed = { tool: value.tool, args: 'args' in value ? value.args : {} };
    }
  } catch { /* Keep legacy tool text available when it has no structured fields. */ }
  return (
    <details className="tide-session__tool tide-session__tool--call">
      <summary><TideIcon name="tool" /><strong>{parsed.tool}</strong><span>{t('chat.tool.params')}</span>
        {timestamp && <time dateTime={timestamp} title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</time>}
      </summary>
      <pre><BoundedText text={typeof parsed.args === 'string' ? parsed.args : JSON.stringify(parsed.args, null, 2) ?? ''} /></pre>
    </details>
  );
}

function ToolResultBubble({ content, timestamp, toolImages, mediaScope }: { content: string; timestamp?: string;
  toolImages?: ToolImageRef[]; mediaScope: ToolMediaScope }) {
  const { t } = useLocale();
  let parsed = { tool: '?', result: content, ok: true };
  try {
    const value: unknown = JSON.parse(content);
    if (value && typeof value === 'object' && 'tool' in value && typeof value.tool === 'string') {
      const result = 'result' in value ? value.result : '';
      parsed = { tool: value.tool, result: typeof result === 'string' ? result : JSON.stringify(result) ?? '',
        ok: !('ok' in value) || value.ok !== false };
    }
  } catch { /* Keep legacy tool text available when it has no structured fields. */ }
  return (
    <details className={`tide-session__tool tide-session__tool--${parsed.ok ? 'done' : 'error'}`}>
      <summary><TideIcon name={parsed.ok ? 'check' : 'close'} /><strong>{parsed.tool}</strong><span>{t('chat.tool.result')}</span>
        {timestamp && <time dateTime={timestamp} title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</time>}
      </summary>
      <pre>
        <BoundedText text={parsed.result} />
      </pre>
      {!!toolImages?.length && <ToolResultImages images={toolImages} scope={mediaScope} />}
    </details>
  );
}
