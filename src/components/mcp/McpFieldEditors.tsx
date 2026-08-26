import type { KeyValuePair } from './mcp-form';
import { useLocale } from '../../i18n/LocaleContext';

export function StringListEditor({ label, values, placeholder, onChange }: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const { t } = useLocale();
  const update = (index: number, value: string) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  const remove = (index: number) => onChange(values.filter((_item, itemIndex) => itemIndex !== index));
  return (
    <section className="mcp-add-form__section">
      <div className="mcp-add-form__section-head">
        <span>{label}</span>
        <button type="button" className="capability-button capability-button--secondary capability-button--compact mcp-btn" onClick={() => onChange([...values, ''])}>{t('mcp.fields.add')}</button>
      </div>
      {values.map((value, index) => (
        <div className="mcp-add-form__row" key={index}>
          <input className="mcp-add-form__input mcp-add-form__input--wide" aria-label={`${label} ${index + 1}`} placeholder={placeholder} value={value} onChange={event => update(index, event.target.value)} />
          <button type="button" className="capability-button capability-button--danger capability-button--compact mcp-btn" onClick={() => remove(index)}>{t('mcp.fields.remove')}</button>
        </div>
      ))}
      {values.length === 0 && <div className="mcp-add-form__empty">{t('mcp.fields.empty')}</div>}
    </section>
  );
}

export function PairListEditor({ label, pairs, keyPlaceholder, valuePlaceholder, onChange }: {
  label: string;
  pairs: KeyValuePair[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  onChange: (pairs: KeyValuePair[]) => void;
}) {
  const { t } = useLocale();
  const update = (index: number, patch: Partial<KeyValuePair>) => onChange(
    pairs.map((pair, pairIndex) => pairIndex === index ? { ...pair, ...patch } : pair),
  );
  const remove = (index: number) => onChange(pairs.filter((_pair, pairIndex) => pairIndex !== index));
  return (
    <section className="mcp-add-form__section">
      <div className="mcp-add-form__section-head">
        <span>{label}</span>
        <button type="button" className="capability-button capability-button--secondary capability-button--compact mcp-btn" onClick={() => onChange([...pairs, { key: '', value: '' }])}>{t('mcp.fields.add')}</button>
      </div>
      {pairs.map((pair, index) => (
        <div className="mcp-add-form__row" key={index}>
          <input className="mcp-add-form__input" aria-label={t('mcp.fields.keyLabel', { label, index: index + 1 })} placeholder={keyPlaceholder} value={pair.key} onChange={event => update(index, { key: event.target.value })} />
          <input className="mcp-add-form__input mcp-add-form__input--wide" aria-label={t('mcp.fields.valueLabel', { label, index: index + 1 })} placeholder={valuePlaceholder} value={pair.value} onChange={event => update(index, { value: event.target.value })} />
          <button type="button" className="capability-button capability-button--danger capability-button--compact mcp-btn" onClick={() => remove(index)}>{t('mcp.fields.remove')}</button>
        </div>
      ))}
      {pairs.length === 0 && <div className="mcp-add-form__empty">{t('mcp.fields.empty')}</div>}
    </section>
  );
}
