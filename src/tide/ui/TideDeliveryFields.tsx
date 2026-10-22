import { useId } from 'react';
import type { TidePushMode } from '../../api/tide';
import { useLocale } from '../../i18n/LocaleContext';
import TideIcon from './TideIcon';

export interface TideDeliveryValue {
  pushMode: TidePushMode; windowN: number; targetSessionId: string; selfLoop: boolean;
}

export default function TideDeliveryFields({ value, onChange, sessions, loading, sessionError }: {
  value: TideDeliveryValue; onChange: (patch: Partial<TideDeliveryValue>) => void;
  sessions: { id: string; title: string }[]; loading: boolean; sessionError: string;
}) {
  const { t } = useLocale();
  const id = useId();
  return <section className="tide-form__section" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}><TideIcon name="message" />{t('tide.create.pushTarget')}</h3>
    <div className="tide-form__choices" role="group" aria-label={t('tide.create.pushTarget')}>
      {(['accumulate', 'designated'] as const).map(mode => <label key={mode} className="tide-form__choice"
        data-selected={(value.selfLoop ? 'accumulate' : value.pushMode) === mode}>
        <input type="radio" name={`${id}-delivery`} value={mode} disabled={value.selfLoop}
          checked={(value.selfLoop ? 'accumulate' : value.pushMode) === mode}
          onChange={() => onChange({ pushMode: mode })} />
        <span><strong>{t(mode === 'accumulate' ? 'tide.create.accumulateTitle' : 'tide.create.designatedTitle')}</strong>
          <small>{t(mode === 'accumulate' ? 'tide.create.accumulateDescription' : 'tide.create.designatedDescription')}</small></span>
      </label>)}
    </div>
    {value.pushMode === 'designated' && !value.selfLoop ? <div className="tide-form__field tide-form__delivery-options">
      <label htmlFor={`${id}-session`}>{t('tide.create.targetSession')}</label>
      <select id={`${id}-session`} value={value.targetSessionId} disabled={loading}
        onChange={event => onChange({ targetSessionId: event.target.value })}>
        <option value="">{t(loading ? 'tide.create.loadingSessions' : 'tide.create.selectSession')}</option>
        {sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
      {sessionError && <p role="alert" className="tide-form__error">{sessionError}</p>}
      {!loading && !sessionError && sessions.length === 0 && <p className="tide-form__hint">{t('tide.create.noSessions')}</p>}
    </div> : <div className="tide-form__delivery-options">
      {!value.selfLoop && <div className="tide-form__retention">
        <label htmlFor={`${id}-window`}>{t('tide.create.windowRounds')}</label>
        <input id={`${id}-window`} type="number" min={1} step={1} value={value.windowN}
          aria-describedby={`${id}-window-hint`}
          onChange={event => onChange({ windowN: parseInt(event.target.value, 10) || 1 })} />
        <p className="tide-form__hint" id={`${id}-window-hint`}>{t('tide.create.windowDescription')}</p>
      </div>}
    </div>}
    <label className="tide-form__toggle">
      <span><strong>{t('tide.create.selfLoopTitle')}</strong><small>{t('tide.create.selfLoopDescription')}</small></span>
      <input type="checkbox" role="switch" checked={value.selfLoop}
        onChange={event => onChange({ selfLoop: event.target.checked })} />
    </label>
  </section>;
}
