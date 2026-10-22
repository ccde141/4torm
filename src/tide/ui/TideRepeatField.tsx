import { useId, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { parseTideRepeatCountInput } from './tide-form-values';

export default function TideRepeatField({ value, onChange, disabled = false }: {
  value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [emptyCount, setEmptyCount] = useState(false);
  return <div className="tide-form__field">
    <label htmlFor={id}>{t('tide.create.repeatLabel')}</label>
    <div className="tide-form__repeat">
      <select id={id} value={value === -1 ? 'forever' : 'limited'} disabled={disabled}
        onChange={event => { setEmptyCount(false); onChange(event.target.value === 'forever' ? -1 : 1); }}>
        <option value="forever">{t('tide.create.repeatForever')}</option>
        <option value="limited">{t('tide.create.repeatLimited')}</option>
      </select>
      {value !== -1 && !disabled && <label className="tide-form__count">
        <input type="number" min={0} step={1} required value={emptyCount ? '' : value} aria-label={t('tide.create.repeatCount')}
          onChange={event => {
            const raw = event.target.value;
            setEmptyCount(raw === '');
            if (raw !== '') onChange(parseTideRepeatCountInput(raw));
          }} />
        <span>{t('tide.create.times')}</span>
      </label>}
    </div>
  </div>;
}
