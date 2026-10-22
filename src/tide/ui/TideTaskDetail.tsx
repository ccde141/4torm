import BoundedText from '../../engine/text-display/BoundedText';
import { useEffect, useState } from 'react';
import { updateTask, type TideRunRecord, type TideRunState, type TideTask } from '../../api/tide';
import { useLocale } from '../../i18n/LocaleContext';
import { buildTideSchedule, parseTideScheduleForm, validateTideScheduleForm } from './tide-form-values';
import TideTaskEditor from './TideTaskEditor';
import TideTaskOverview from './TideTaskOverview';
import TideRunHistory from './TideRunHistory';
import TideIcon from './TideIcon';
import { useTideUsage } from './tide-token-label';
import { CompactionNotice } from '../../components/common/CompactionNotice';
import { CompactionStatus } from '../../components/common/CompactionStatus';
import { compactionActivity } from '../../components/common/compaction-activity';

interface TideTaskDetailProps {
  task: TideTask;
  agentName?: string;
  runs: TideRunRecord[];
  runState: TideRunState | null;
  running?: boolean;
  onViewSession: (sessionId: string, agentId?: string) => void;
  onDeleteSession: () => void;
  onUpdated: (task: TideTask) => void;
}

function createForm(task: TideTask) {
  return { name: task.name, prompt: task.prompt, windowN: task.windowN,
    repeatCount: task.repeatCount, ...parseTideScheduleForm(task.schedule) };
}

export default function TideTaskDetail({ task, agentName, runs, runState, running = false,
  onViewSession, onDeleteSession, onUpdated }: TideTaskDetailProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => createForm(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingSessionDelete, setConfirmingSessionDelete] = useState(false);
  const canDeleteSession = !task.enabled && !running && !!task.targetSessionId && task.pushMode === 'accumulate';
  const tokenUsage = useTideUsage(`${task.agentId}:${task.id}`, runState?.usage?.latest
    ?? runs.find(run => run.usage?.latest)?.usage?.latest,
  running || runState?.status === 'queued' || runState?.status === 'running'
    || runState?.compaction?.type === 'compact-start');

  useEffect(() => {
    if (!confirmingSessionDelete) return;
    const timeout = setTimeout(() => setConfirmingSessionDelete(false), 3000);
    return () => clearTimeout(timeout);
  }, [confirmingSessionDelete]);

  useEffect(() => {
    setForm(createForm(task)); setEditing(false); setError(''); setConfirmingSessionDelete(false);
  }, [task.id]);

  const handleSave = async () => {
    if (saving || task.enabled || running) return;
    setError('');
    if (!form.name.trim() || !form.prompt.trim()) { setError(t('tide.create.validation.required')); return; }
    const scheduleError = validateTideScheduleForm(form);
    if (scheduleError) { setError(t(`tide.create.validation.${scheduleError}`)); return; }
    const schedule = buildTideSchedule(form);
    setSaving(true);
    try {
      const updated = await updateTask(task.id, {
        name: form.name, schedule, prompt: form.prompt,
        windowN: form.windowN, repeatCount: form.repeatCount,
      });
      onUpdated(updated); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  return <div className="tide-detail">
    <CompactionStatus activity={compactionActivity(runState?.compaction)} />
    {runState?.compactionNotice && <CompactionNotice message={runState.compactionNotice} />}
    {editing && !task.enabled && !running ? <>
      <h2 className="tide-detail__edit-title">{task.name}</h2>
      <TideTaskEditor value={form} onChange={patch => { setForm(value => ({ ...value, ...patch })); setError(''); }}
        onSave={() => { void handleSave(); }} onCancel={() => { setForm(createForm(task)); setError(''); setEditing(false); }}
        saving={saving} error={error} selfLoop={task.selfLoop} retainedContext={task.pushMode === 'accumulate'} />
    </> : <>
      <TideTaskOverview task={task} agentName={agentName} usage={tokenUsage} running={running} runState={runState}>
        {!task.enabled && !running && <button type="button" className="tide-detail__button"
          onClick={() => { setForm(createForm(task)); setError(''); setEditing(true); }}>
          <TideIcon name="settings" />{t('tide.detail.edit')}</button>}
      </TideTaskOverview>
      <section className="tide-detail__prompt" aria-label={t('tide.create.promptLabel')}>
        <h3><TideIcon name="message" />{t('tide.create.promptLabel')}</h3>
        <div className="tide-detail__prompt-text"><BoundedText text={task.prompt} /></div>
        {canDeleteSession && <footer>
          <button type="button" className="tide-detail__button tide-detail__button--danger"
            data-confirming={confirmingSessionDelete} onClick={() => {
              if (confirmingSessionDelete) { setConfirmingSessionDelete(false); onDeleteSession(); }
              else setConfirmingSessionDelete(true);
            }}><TideIcon name="archive" />{t(confirmingSessionDelete ? 'tide.detail.confirmDeleteSession' : 'tide.detail.deleteSession')}</button>
        </footer>}
      </section>
    </>}
    <TideRunHistory task={task} runs={runs} onViewSession={onViewSession} />
  </div>;
}
