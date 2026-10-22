import { useId } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import type { TideScheduleForm } from './tide-form-values';
import TideScheduleFields from './TideScheduleFields';
import TideRepeatField from './TideRepeatField';
import TideIcon from './TideIcon';

export interface TideTaskEditValue extends TideScheduleForm {
  name: string; prompt: string; windowN: number; repeatCount: number;
}

export default function TideTaskEditor({ value, onChange, onSave, onCancel, saving, error, selfLoop, retainedContext }: {
  value: TideTaskEditValue; onChange: (patch: Partial<TideTaskEditValue>) => void;
  onSave: () => void; onCancel: () => void; saving: boolean; error: string;
  selfLoop: boolean; retainedContext: boolean;
}) {
  const id = useId();
  const { t } = useLocale();
  return <form className="tide-form tide-form--editor" aria-label={t('tide.detail.edit')} aria-busy={saving}
    onSubmit={event => { event.preventDefault(); onSave(); }}>
    <fieldset className="tide-form__body" disabled={saving}>
      <div className="tide-form__field">
        <label htmlFor={`${id}-name`}>{t('tide.detail.name')}</label>
        <input id={`${id}-name`} value={value.name} onChange={event => onChange({ name: event.target.value })} />
      </div>
      <div className="tide-form__columns">
        <section className="tide-form__section" aria-labelledby={`${id}-schedule`}>
          <h3 id={`${id}-schedule`}><TideIcon name="calendar" />{t('tide.detail.schedule')}</h3>
          <TideScheduleFields value={value} onChange={onChange} />
          <div className="tide-form__editor-options">
            <TideRepeatField value={selfLoop ? -1 : value.repeatCount} onChange={repeatCount => onChange({ repeatCount })} disabled={selfLoop} />
            {retainedContext && !selfLoop && <div className="tide-form__field">
              <label htmlFor={`${id}-window`}>{t('tide.create.windowRounds')}</label>
              <input id={`${id}-window`} type="number" min={1} step={1} value={value.windowN}
                aria-describedby={`${id}-window-hint`}
                onChange={event => onChange({ windowN: parseInt(event.target.value, 10) || 1 })} />
              <p id={`${id}-window-hint`} className="tide-form__hint">{t('tide.create.windowDescription')}</p>
            </div>}
            {selfLoop && <p className="tide-form__hint">{t('tide.create.selfLoopDescription')}</p>}
          </div>
        </section>
        <section className="tide-form__section tide-form__instructions">
          <label className="tide-form__section-label" htmlFor={`${id}-prompt`}><TideIcon name="message" />{t('tide.create.promptLabel')}</label>
          <textarea id={`${id}-prompt`} rows={8} value={value.prompt} onChange={event => onChange({ prompt: event.target.value })} />
        </section>
      </div>
    </fieldset>
    {error && <p className="tide-form__error" role="alert">{error}</p>}
    <footer className="tide-form__actions">
      <button type="button" className="tide-form__button" disabled={saving} onClick={onCancel}>{t('tide.detail.cancelEdit')}</button>
      <button type="submit" className="tide-form__button tide-form__button--primary" disabled={saving}>
        <TideIcon name="check" />{t(saving ? 'tide.detail.saving' : 'tide.detail.save')}</button>
    </footer>
  </form>;
}
