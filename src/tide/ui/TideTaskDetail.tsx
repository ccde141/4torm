import { useEffect, useState } from 'react';
import { updateTask, type TideRunRecord, type TideRunState, type TideTask } from '../../api/tide';
import { useLocale } from '../../i18n/LocaleContext';
import type { MessageKey, MessageValues } from '../../i18n/locale';
import { actionBtnStyle, formatRelative, formatSchedule } from './tide-styles';
import { visibleTideNextRun } from './tide-runtime';
import { parseTideRepeatCountInput } from './tide-form-values';
import { tideRunIdentity } from './tide-run-identity';
import { formatTideContextTokens } from './tide-token-label';
import { CompactionNotice } from '../../components/common/CompactionNotice';

interface TideTaskDetailProps {
  task: TideTask;
  runs: TideRunRecord[];
  runState: TideRunState | null;
  onViewSession: (sessionId: string) => void;
  onDeleteSession: () => void;
  onUpdated: (task: TideTask) => void;
}

function parseSchedule(schedule: string) {
  const match = schedule.match(/^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  return {
    h: parseInt(match?.[1] || '0', 10),
    m: parseInt(match?.[2] || '0', 10),
    s: parseInt(match?.[3] || '0', 10),
  };
}

function createForm(task: TideTask) {
  const schedule = parseSchedule(task.schedule);
  return {
    name: task.name, prompt: task.prompt, windowN: task.windowN,
    repeatCount: task.repeatCount, scheduleH: schedule.h,
    scheduleM: schedule.m, scheduleS: schedule.s,
  };
}

function pushModeLabel(task: TideTask, t: (key: MessageKey, values?: MessageValues) => string): string {
  if (task.selfLoop) return t('tide.detail.selfLoop', { count: task.windowN });
  if (task.pushMode === 'designated') return t('tide.detail.designated');
  return t('tide.detail.accumulate', { count: task.windowN });
}

export default function TideTaskDetail({ task, runs, runState,
  onViewSession, onDeleteSession, onUpdated }: TideTaskDetailProps) {
  const { locale, t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => createForm(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingSessionDelete, setConfirmingSessionDelete] = useState(false);
  const canDeleteSession = !task.enabled && !!task.targetSessionId && task.pushMode === 'accumulate';

  useEffect(() => {
    if (!confirmingSessionDelete) return;
    const timeout = setTimeout(() => setConfirmingSessionDelete(false), 3000);
    return () => clearTimeout(timeout);
  }, [confirmingSessionDelete]);

  useEffect(() => {
    setForm(createForm(task));
    setEditing(false);
  }, [task.id]);

  const handleSave = async () => {
    setError('');
    if (form.scheduleH === 0 && form.scheduleM === 0 && form.scheduleS === 0) {
      setError(t('tide.create.validation.interval')); return;
    }
    if (form.scheduleM < 0 || form.scheduleM > 59 || form.scheduleS < 0 || form.scheduleS > 59) {
      setError(t('tide.create.validation.range')); return;
    }
    const schedule = `every ${form.scheduleH}h${form.scheduleM}m${form.scheduleS}s`;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, {
        name: form.name, schedule, prompt: form.prompt,
        windowN: form.windowN, repeatCount: form.repeatCount,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>{task.name}</h2>
    {runState?.compactionNotice ? <CompactionNotice message={runState.compactionNotice} /> : null}
    {editing ? <div style={{ ...detailGrid, gridTemplateColumns: '80px 1fr' }}>
      <label style={editLabel}>{t('tide.detail.name')}</label>
      <input style={editInput} value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} />
      <label style={editLabel}>{t('tide.detail.schedule')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <ScheduleInput value={form.scheduleH} onChange={value => setForm(formValue => ({ ...formValue, scheduleH: value }))} /><span style={unitStyle}>{t('tide.detail.hour')}</span>
        <ScheduleInput value={form.scheduleM} max={59} onChange={value => setForm(formValue => ({ ...formValue, scheduleM: value }))} /><span style={unitStyle}>{t('tide.detail.minute')}</span>
        <ScheduleInput value={form.scheduleS} max={59} onChange={value => setForm(formValue => ({ ...formValue, scheduleS: value }))} /><span style={unitStyle}>{t('tide.detail.second')}</span>
      </div>
      <label style={editLabel}>{t('tide.detail.window')}</label>
      <input style={editInput} type="number" min={1} value={form.windowN} onChange={event => setForm(value => ({ ...value, windowN: parseInt(event.target.value) || 1 }))} />
      <label style={editLabel}>{t('tide.detail.repeat')}</label>
      <input style={editInput} type="number" min={-1} value={form.repeatCount} onChange={event => setForm(value => ({ ...value, repeatCount: parseTideRepeatCountInput(event.target.value) }))} />
      <label style={editLabel}>Prompt</label>
      <textarea style={{ ...editInput, minHeight: '100px', resize: 'vertical' }} value={form.prompt} onChange={event => setForm(value => ({ ...value, prompt: event.target.value }))} />
      <div /><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saving} style={{ ...actionBtnStyle, color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}>{saving ? t('tide.detail.saving') : t('tide.detail.save')}</button>
        {error && <span style={{ color: '#ef4444', fontSize: 'var(--text-xs)' }}>{error}</span>}
      </div>
    </div> : <div style={detailGrid}>
      <DetailRow label="Agent ID" value={task.agentId} />
      <DetailRow label={t('tide.detail.schedule')} value={formatSchedule(task.schedule, locale)} />
      <DetailRow label={t('tide.detail.pushMode')} value={pushModeLabel(task, t)} />
      <DetailRow label={t('tide.detail.repeat')} value={task.repeatCount === -1 ? t('tide.task.forever') : t('tide.detail.repeatCount', { count: task.repeatCount })} />
      <DetailRow label={t('tide.detail.status')} value={task.repeatCount === 0 ? t('tide.task.status.completed') : task.enabled ? t('tide.task.status.running') : t('tide.task.status.paused')} />
      <DetailRow label={locale === 'en-US' ? 'Input tokens' : '输入 tokens'}
        value={formatTideContextTokens(runState?.usage?.latest, locale)}
        title={locale === 'en-US' ? 'Provider-reported input tokens for the latest model request'
          : '最近一次模型请求的输入 token 数，由提供商回报'} />
      {(task.consecutiveErrors ?? 0) > 0 && <DetailRow label={t('tide.detail.failures')} value={t('tide.detail.failureCount', { count: task.consecutiveErrors, paused: (task.consecutiveErrors ?? 0) >= 3 ? t('tide.detail.autoPaused') : '' })} />}
      <DetailRow label={t('tide.detail.lastRun')} value={formatRelative(task.lastRun, locale)} />
      <DetailRow label={t('tide.detail.nextRun')} value={formatRelative(visibleTideNextRun(task), locale)} />
    </div>}
    {!editing && <div style={{ marginTop: 'var(--space-4)' }}><div style={sectionLabel}>Prompt</div><div style={promptBox}>{task.prompt}</div></div>}
    {!task.enabled && <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <button onClick={() => setEditing(!editing)} style={actionBtnStyle}>{editing ? t('tide.detail.cancelEdit') : t('tide.detail.edit')}</button>
      {canDeleteSession && (confirmingSessionDelete
        ? <button onClick={() => { setConfirmingSessionDelete(false); onDeleteSession(); }} style={{ ...actionBtnStyle, color: '#fff', background: '#ef4444', borderColor: '#ef4444' }}>{t('tide.detail.confirmDeleteSession')}</button>
        : <button onClick={() => setConfirmingSessionDelete(true)} style={{ ...actionBtnStyle, color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>{t('tide.detail.deleteSession')}</button>)}
    </div>}
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div style={sectionLabel}>{t('tide.detail.runHistory', { count: runs.length })}</div>
      {runs.length === 0 && <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', padding: 'var(--space-3)' }}>{t('tide.detail.noRuns')}</div>}
      {runs.map(run => <div key={tideRunIdentity(run)} style={runItem}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: run.status === 'success' ? '#22c55e' : '#ef4444' }}>{run.status === 'success' ? t('tide.detail.success') : t('tide.detail.failed')}</span>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
            {t('tide.detail.runMeta', { time: formatRelative(run.timestamp, locale), duration: run.durationMs, turns: run.turns })}
            <span title={locale === 'en-US'
              ? 'Provider-reported input tokens for the latest model request'
              : '最近一次模型请求的输入 token 数，由提供商回报'}>
              {' · '}{formatTideContextTokens(run.usage?.latest, locale)}{run.usage?.latest ? ' tokens' : ''}
            </span>
          </span>
        </div>
        {run.error && <div style={{ color: '#ef4444', fontSize: 'var(--text-xs)', marginBottom: '4px' }}>{run.error}</div>}
        {run.answer && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{run.answer.slice(0, 200)}{run.answer.length > 200 ? '…' : ''}</div>}
        {run.toolCalls.length > 0 && <details style={{ marginTop: 'var(--space-2)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-accent)', fontSize: 'var(--text-xs)' }}>
            {t('tide.detail.toolCalls', { count: run.toolCalls.length })}
          </summary>
          {run.toolCalls.map((call, index) => <div key={index} style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
            <strong>{call.tool}</strong>
            <pre style={toolRecordStyle}>{JSON.stringify(call.args, null, 2)}</pre>
            <pre style={toolRecordStyle}>{call.result}</pre>
          </div>)}
        </details>}
        {task.pushMode === 'accumulate' && task.windowN === 1
          ? <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>{t('tide.detail.archivedRun')}</div>
          : <a href="#" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)' }} onClick={event => { event.preventDefault(); onViewSession(run.sessionId); }}>{t('tide.detail.viewSession')}</a>}
      </div>)}
    </div>
  </div>;
}

function ScheduleInput({ value, max, onChange }: { value: number; max?: number; onChange: (value: number) => void }) {
  return <input type="number" min={0} max={max} value={value} onChange={event => onChange(parseInt(event.target.value, 10) || 0)} style={{ ...editInput, width: '56px' }} />;
}

function DetailRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <><div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }} title={title}>{label}</div><div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }} title={title}>{value}</div></>;
}

const sectionLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-2)' };
const detailGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-2) var(--space-3)', padding: 'var(--space-3)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius-md)' };
const promptBox: React.CSSProperties = { padding: 'var(--space-3)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius-md)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' };
const runItem: React.CSSProperties = { padding: 'var(--space-3)', marginBottom: 'var(--space-2)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius-md)' };
const editLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', alignSelf: 'center' };
const editInput: React.CSSProperties = { width: '100%', padding: 'var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-sm)', color: 'var(--color-text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'inherit' };
const unitStyle: React.CSSProperties = { fontSize: '10px', color: 'var(--color-text-tertiary)' };
const toolRecordStyle: React.CSSProperties = { maxHeight: '180px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text-secondary)' };
