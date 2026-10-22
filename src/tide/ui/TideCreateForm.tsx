/** 潮汐任务创建：保存状态与交互；布局、时间与会话选项留在本岛。 */
import { useState, useEffect, useId, useRef } from 'react';
import { createTask, type CreateTaskInput } from '../../api/tide';
import { getSessionsByAgent } from '../../store/chat';
import { useLocale } from '../../i18n/LocaleContext';
import { buildTideSchedule, parseTideScheduleForm, validateTideScheduleForm } from './tide-form-values';
import TideScheduleFields from './TideScheduleFields';
import TideDeliveryFields, { type TideDeliveryValue } from './TideDeliveryFields';
import TideRepeatField from './TideRepeatField';
import TideIcon from './TideIcon';

interface CreateFormProps {
  agentId: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function CreateForm({ agentId, onDone, onCancel }: CreateFormProps) {
  const { t } = useLocale();
  const id = useId();
  const [name, setName] = useState('');
  const [scheduleForm, setScheduleForm] = useState(() => parseTideScheduleForm('every 5m'));
  const [prompt, setPrompt] = useState('');
  const [repeatCount, setRepeatCount] = useState(-1);
  const [delivery, setDelivery] = useState<TideDeliveryValue>({
    pushMode: 'accumulate', windowN: 1, targetSessionId: '', selfLoop: false,
  });
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (delivery.pushMode !== 'designated' || delivery.selfLoop || !agentId) return;
    let current = true;
    setLoadingSessions(true); setSessionError(''); setSessions([]);
    void getSessionsByAgent(agentId).then(list => {
      if (current) setSessions(list.map(session => ({ id: session.id, title: session.title || session.id })));
    }).catch(cause => {
      if (current) setSessionError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (current) setLoadingSessions(false); });
    return () => { current = false; };
  }, [delivery.pushMode, delivery.selfLoop, agentId]);

  const submit = async () => {
    if (inFlight.current) return;
    setError('');
    if (!name.trim() || !prompt.trim()) { setError(t('tide.create.validation.required')); return; }
    if (!agentId) { setError(t('tide.create.validation.agent')); return; }
    const { pushMode, selfLoop, windowN, targetSessionId } = delivery;
    if (pushMode === 'accumulate' && !selfLoop) {
      if (!Number.isInteger(windowN) || windowN < 1) { setError(t('tide.create.validation.nMin')); return; }
      if (windowN >= 2 && windowN % 2 !== 0) { setError(t('tide.create.validation.nEven')); return; }
    }
    if (pushMode === 'designated' && !selfLoop && !targetSessionId) {
      setError(t('tide.create.validation.session')); return;
    }
    const scheduleError = validateTideScheduleForm(scheduleForm);
    if (scheduleError) { setError(t(`tide.create.validation.${scheduleError}`)); return; }
    const schedule = buildTideSchedule(scheduleForm);
    inFlight.current = true; setSubmitting(true);
    try {
      const input: CreateTaskInput = {
        name: name.trim(), schedule, prompt: prompt.trim(), agentId,
        repeatCount: selfLoop ? -1 : repeatCount,
        pushMode: selfLoop ? 'accumulate' : pushMode, windowN: selfLoop ? 2 : windowN, selfLoop,
        targetSessionId: !selfLoop && pushMode === 'designated' ? targetSessionId : undefined,
      };
      await createTask(input);
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  return <div className="tide-form-shell">
    <form className="tide-form" aria-labelledby={`${id}-title`} aria-busy={submitting}
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header className="tide-form__header">
        <span className="tide-form__symbol"><TideIcon name="clock" /></span>
        <div><h2 id={`${id}-title`}>{t('tide.create.title')}</h2><p>{t('tide.create.description')}</p></div>
        <button type="button" className="tide-form__close" onClick={onCancel} disabled={submitting}
          aria-label={t('tide.create.cancel')}><TideIcon name="close" /></button>
      </header>
      <fieldset className="tide-form__body" disabled={submitting}>
        <div className="tide-form__field tide-form__name">
          <label htmlFor={`${id}-name`}>{t('tide.create.namePlaceholder')}</label>
          <input id={`${id}-name`} value={name} placeholder={t('tide.create.nameExample')}
            onChange={event => { setName(event.target.value); setError(''); }} />
        </div>
        <div className="tide-form__columns">
          <section className="tide-form__section" aria-labelledby={`${id}-schedule`}>
            <h3 id={`${id}-schedule`}><TideIcon name="calendar" />{t('tide.create.scheduleTitle')}</h3>
            <TideScheduleFields value={scheduleForm} onChange={patch => { setScheduleForm(value => ({ ...value, ...patch })); setError(''); }} />
            <div className="tide-form__repeat-section"><TideRepeatField value={delivery.selfLoop ? -1 : repeatCount}
              onChange={value => { setRepeatCount(value); setError(''); }} disabled={delivery.selfLoop} /></div>
          </section>
          <section className="tide-form__section tide-form__instructions">
            <label className="tide-form__section-label" htmlFor={`${id}-prompt`}>
              <TideIcon name="message" />{t('tide.create.promptLabel')}</label>
            <textarea id={`${id}-prompt`} value={prompt} placeholder={t('tide.create.promptExample')} rows={8}
              onChange={event => { setPrompt(event.target.value); setError(''); }} />
          </section>
        </div>
        <TideDeliveryFields value={delivery} onChange={patch => { setDelivery(value => ({ ...value, ...patch })); setError(''); }}
          sessions={sessions} loading={loadingSessions} sessionError={sessionError} />
      </fieldset>
      {error && <p role="alert" className="tide-form__error">{error}</p>}
      <footer className="tide-form__actions">
        <button type="button" className="tide-form__button" onClick={onCancel} disabled={submitting}>{t('tide.create.cancel')}</button>
        <button type="submit" className="tide-form__button tide-form__button--primary" disabled={submitting}>
          {submitting ? t('tide.create.creating') : t('tide.create.create')}<TideIcon name="arrow" /></button>
      </footer>
    </form>
  </div>;
}
