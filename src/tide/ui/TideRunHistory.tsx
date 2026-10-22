import { useId } from 'react';
import type { TideRunRecord, TideTask } from '../../api/tide';
import BoundedText from '../../engine/text-display/BoundedText';
import MarkdownText from '../../engine/text-display/MarkdownText';
import { useLocale } from '../../i18n/LocaleContext';
import TideIcon from './TideIcon';
import { tideRunIdentity } from './tide-run-identity';
import { tideRunSessionTarget } from './tide-run-session';
import { formatTideContextTokens } from './tide-token-label';
import { formatRelative } from './tide-styles';
import ToolResultImages from '../../components/common/ToolResultImages';

interface TideRunHistoryProps {
  task: TideTask;
  runs: TideRunRecord[];
  onViewSession: (sessionId: string, agentId?: string) => void;
}

export default function TideRunHistory({ task, runs, onViewSession }: TideRunHistoryProps) {
  const { t } = useLocale();
  const headingId = useId();

  return <section className="tide-run-history" aria-labelledby={headingId}>
    <h3 id={headingId} className="tide-run-history__heading">
      <TideIcon name="history" />{t('tide.detail.runHistory', { count: runs.length })}
    </h3>
    {runs.length === 0 ? <div className="tide-run-history__empty">
      <TideIcon name="history" /><p>{t('tide.detail.noRuns')}</p>
    </div> : <ol className="tide-run-history__list">
      {runs.map(run => <li key={tideRunIdentity(run)} className="tide-run-history__item"
        data-status={run.status}>
        <RunCard run={run} fallbackAgentId={task.agentId} onViewSession={onViewSession} />
      </li>)}
    </ol>}
  </section>;
}

function RunCard({ run, fallbackAgentId, onViewSession }: {
  run: TideRunRecord; fallbackAgentId: string;
  onViewSession: (sessionId: string, agentId?: string) => void;
}) {
  const { locale, t } = useLocale();
  const identity = tideRunIdentity(run);
  const exactTime = new Date(run.timestamp).toLocaleString(locale);
  const session = tideRunSessionTarget(run, fallbackAgentId);

  return <article className="tide-run-card">
    <header className="tide-run-card__header">
      <span className="tide-run-card__status" data-status={run.status}>
        {t(run.status === 'success' ? 'tide.detail.success'
          : run.status === 'aborted' ? 'tide.task.status.aborted' : 'tide.detail.failed')}
      </span>
      <time dateTime={run.timestamp} title={exactTime}>{formatRelative(run.timestamp, locale)}</time>
    </header>
    <div className="tide-run-card__meta">
      <span><TideIcon name="clock" />{t('tide.detail.runMeta', {
        time: new Date(run.timestamp).toLocaleTimeString(locale), duration: run.durationMs, turns: run.turns,
      })}</span>
      <span title={t('tide.detail.inputUsage')}>
        {t('tide.detail.inputUsage')}<strong>{formatTideContextTokens(run.usage?.latest, locale)}</strong>
      </span>
    </div>
    {run.error && <div className="tide-run-card__error" data-status={run.status}>
      <BoundedText id={`${identity}:error`} text={run.error} /></div>}
    {run.answer && <RunAnswer text={run.answer} identity={identity} />}
    {run.toolCalls.length > 0 && <details className="tide-run-card__tools">
      <summary><TideIcon name="settings" />{t('tide.detail.toolCalls', { count: run.toolCalls.length })}
        <TideIcon name="arrow" />
      </summary>
      <div className="tide-run-card__tool-list">
        {run.toolCalls.map((call, index) => <section className="tide-run-card__tool" key={index}>
          <h4><span>{index + 1}</span>{call.tool}</h4>
          <div className="tide-run-card__tool-label">{t('tide.detail.toolArguments')}</div>
          <pre><BoundedText id={`${identity}:tool:${index}:args`} text={JSON.stringify(call.args, null, 2) ?? ''} /></pre>
          <div className="tide-run-card__tool-label">{t('tide.detail.toolResult')}</div>
          <pre><BoundedText id={`${identity}:tool:${index}:result`} text={call.result ?? ''} /></pre>
          {!!call.toolImages?.length && run.runId && <ToolResultImages images={call.toolImages}
            scope={{ feature: 'tide', taskId: run.taskId, runId: run.runId }} />}
        </section>)}
      </div>
    </details>}
    <footer className="tide-run-card__footer">
      {run.sessionState === 'archived' ? <p>{t('tide.detail.archivedRun')}</p> : session &&
        <button type="button" className="tide-run-card__session"
          onClick={() => onViewSession(session.sessionId, session.agentId)}>
          <TideIcon name="message" />{t('tide.detail.viewSession')}<TideIcon name="arrow" />
        </button>}
    </footer>
  </article>;
}

function RunAnswer({ text, identity }: { text: string; identity: string }) {
  const { t } = useLocale();
  if (text.length <= 200) return <div className="tide-run-card__answer">
    <MarkdownText id={`${identity}:answer`} text={text} />
  </div>;
  return <details className="tide-run-card__answer-details">
    <summary>
      <span className="tide-run-card__preview">{text.slice(0, 200)}…</span>
      <span className="tide-run-card__answer-toggle">
        <span className="tide-run-card__expand">{t('tide.detail.expandResult')}</span>
        <span className="tide-run-card__collapse">{t('tide.detail.collapseResult')}</span>
        <TideIcon name="arrow" />
      </span>
    </summary>
    <div className="tide-run-card__full-answer"><MarkdownText id={`${identity}:answer`} text={text} /></div>
  </details>;
}
