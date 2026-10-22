import { useId } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import type { TideScheduleForm } from './tide-form-values';
import TideIcon from './TideIcon';
import TideDailyTimeInput from './TideDailyTimeInput';

interface Props {
  value: TideScheduleForm;
  onChange: (patch: Partial<TideScheduleForm>) => void;
}

export default function TideScheduleFields({ value, onChange }: Props) {
  const { t } = useLocale();
  const id = useId();
  return <div className="tide-schedule">
    <fieldset className="tide-schedule__modes">
      <legend className="tide-schedule__sr-only">{t('tide.create.scheduleMode')}</legend>
      {(['interval', 'daily'] as const).map(mode => <label key={mode}
        className="tide-schedule__mode" data-selected={value.scheduleMode === mode}>
        <input className="tide-schedule__sr-only" type="radio" name={`${id}-schedule-mode`}
          value={mode} checked={value.scheduleMode === mode}
          onChange={() => onChange({ scheduleMode: mode })} />
        <span className="tide-schedule__mode-icon"><TideIcon name={mode === 'daily' ? 'calendar' : 'repeat'} /></span>
        <span>{t(mode === 'daily' ? 'tide.create.dailyMode' : 'tide.create.intervalMode')}</span>
        <span className="tide-schedule__radio-mark" aria-hidden="true" />
      </label>)}
    </fieldset>
    {value.scheduleMode === 'daily' ? <div className="tide-schedule__daily">
      <span className="tide-schedule__caption">{t('tide.create.dailyTime')}</span>
      <TideDailyTimeInput value={value.dailyTime} onChange={dailyTime => onChange({ dailyTime })}
        label={t('tide.create.dailyTime')} hourLabel={t('tide.create.hour')}
        minuteLabel={t('tide.create.minute')} describedBy={`${id}-daily-hint`} />
      <p className="tide-schedule__hint" id={`${id}-daily-hint`}>{t('tide.create.dailyHint')}</p>
    </div> : <div className="tide-schedule__interval" role="group" aria-label={t('tide.create.interval')}>
      {(['scheduleH', 'scheduleM', 'scheduleS'] as const).map((key, index) => {
        const label = t(index === 0 ? 'tide.create.hour' : index === 1 ? 'tide.create.minute' : 'tide.create.second');
        return <label key={key} className="tide-schedule__duration">
          <input type="number" min={0} max={index === 0 ? undefined : 59} step={1} value={value[key]}
            aria-label={label} onChange={event => onChange({ [key]: Number(event.target.value) })}
          />
          <span>{label}</span>
        </label>;
      })}
    </div>}
  </div>;
}
