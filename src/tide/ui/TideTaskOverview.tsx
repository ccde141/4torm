import type { ReactNode } from 'react';
import type { TideRunState, TideTask, TideTokenUsage } from '../../api/tide';
import { useLocale } from '../../i18n/LocaleContext';
import { formatRelative, formatSchedule } from './tide-styles';
import { parseTideScheduleForm } from './tide-form-values';
import { resolveTideRuntime, visibleTideNextRun } from './tide-runtime';
import TideIcon from './TideIcon';
import { formatCurrentInput, formatModelUsage } from '../../lib/model-usage';

export default function TideTaskOverview({ task, agentName, running, runState, children }: {
  task: TideTask; agentName?: string; usage?: TideTokenUsage; running: boolean;
  runState: TideRunState | null; children?: ReactNode;
}) {
  const { t, locale } = useLocale();
  const progress = runState?.usage?.modelUsage;
  const activeRequest = progress?.latest && ['prepared', 'sent', 'streaming'].includes(progress.latest.state);
  const metering = formatCurrentInput(task.currentInput, locale, progress)
    ?? (activeRequest ? formatModelUsage(progress, locale) : undefined);
  const dailySchedule = parseTideScheduleForm(task.schedule).scheduleMode === 'daily';
  const nextRun = visibleTideNextRun(task);
  const runtime = resolveTideRuntime(task, runState ? { operationId: task.id, title: task.name,
    runId: runState.runId, status: runState.status } : undefined, false);
  const kind = running && !runtime.active ? 'running' : runtime.kind;
  const status = t(kind === 'running' ? 'tide.task.status.executing' : `tide.task.status.${kind}`);
  const delivery = task.selfLoop ? t('tide.detail.selfLoop', { count: task.windowN })
    : task.pushMode === 'designated' ? t('tide.detail.designated')
    : t('tide.detail.accumulate', { count: task.windowN });

  return <section className="tide-detail__overview" aria-label={t('tide.detail.overview')}>
    <header className="tide-detail__heading">
      <span className="tide-detail__symbol"><TideIcon name="clock" /></span>
      <div className="tide-detail__identity"><p>{t('tide.detail.overview')}</p><h2>{task.name}</h2></div>
      <span className="tide-detail__status" data-state={kind} aria-live="polite"><span />{status}</span>
      {children && <div className="tide-detail__heading-actions">{children}</div>}
    </header>
    <div className="tide-detail__agent" title={task.agentId}>
      <TideIcon name="user" /><span>{t('tide.detail.agent')}</span>
      <strong>{agentName || task.agentId}</strong>{agentName && <code>{task.agentId}</code>}
    </div>
    <div className="tide-detail__metrics">
      <Metric icon="calendar" label={t('tide.detail.schedule')} value={formatSchedule(task.schedule, locale)} />
      <Metric icon="clock" label={t('tide.detail.nextRun')} value={dailySchedule && nextRun
        ? new Date(nextRun).toLocaleString(locale, { timeZoneName: 'short' }) : formatRelative(nextRun, locale)}
        title={nextRun ? new Date(nextRun).toLocaleString(locale, { timeZoneName: 'short' }) : undefined} />
      <Metric icon="message" label={t('tide.detail.inputUsage')} value={metering?.label ?? '—'}
        title={metering?.title ?? t('tide.session.usageHint')} />
    </div>
    <dl className="tide-detail__facts">
      <div><dt>{t('tide.detail.pushMode')}</dt><dd>{delivery}</dd></div>
      <div><dt>{t('tide.create.repeatLabel')}</dt><dd>{task.repeatCount === -1
        ? t('tide.create.repeatForever') : t('tide.detail.repeatCount', { count: task.repeatCount })}</dd></div>
      <div><dt>{t('tide.detail.lastRun')}</dt><dd title={task.lastRun}>{formatRelative(task.lastRun, locale)}</dd></div>
      <div><dt>{t('tide.detail.status')}</dt><dd>{task.repeatCount === 0 ? t('tide.task.status.completed')
        : task.enabled ? t('tide.task.status.running') : t('tide.task.status.paused')}</dd></div>
    </dl>
    {(task.consecutiveErrors ?? 0) > 0 && <p className="tide-detail__failure">{t('tide.detail.failures')} · {t('tide.detail.failureCount', {
      count: task.consecutiveErrors, paused: task.consecutiveErrors >= 3 ? t('tide.detail.autoPaused') : '',
    })}</p>}
    {dailySchedule && <p className="tide-detail__clock-note"><TideIcon name="clock" />{t('tide.create.dailyHint')}</p>}
  </section>;
}

function Metric({ icon, label, value, title }: {
  icon: 'calendar' | 'clock' | 'message'; label: string; value: string; title?: string;
}) {
  return <div className="tide-detail__metric" title={title}>
    <span><TideIcon name={icon} />{label}</span><strong>{value}</strong>
  </div>;
}
