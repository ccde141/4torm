import type { KeyValuePair } from './mcp-form';

export function StringListEditor({ label, values, placeholder, onChange }: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const update = (index: number, value: string) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  const remove = (index: number) => onChange(values.filter((_item, itemIndex) => itemIndex !== index));
  return (
    <section className="mcp-add-form__section">
      <div className="mcp-add-form__section-head">
        <span>{label}</span>
        <button type="button" className="mcp-btn mcp-btn--secondary" onClick={() => onChange([...values, ''])}>+ 添加</button>
      </div>
      {values.map((value, index) => (
        <div className="mcp-add-form__row" key={index}>
          <input className="mcp-add-form__input mcp-add-form__input--wide" aria-label={`${label} ${index + 1}`} placeholder={placeholder} value={value} onChange={event => update(index, event.target.value)} />
          <button type="button" className="mcp-btn mcp-btn--danger" onClick={() => remove(index)}>移除</button>
        </div>
      ))}
      {values.length === 0 && <div className="mcp-add-form__empty">暂未添加</div>}
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
  const update = (index: number, patch: Partial<KeyValuePair>) => onChange(
    pairs.map((pair, pairIndex) => pairIndex === index ? { ...pair, ...patch } : pair),
  );
  const remove = (index: number) => onChange(pairs.filter((_pair, pairIndex) => pairIndex !== index));
  return (
    <section className="mcp-add-form__section">
      <div className="mcp-add-form__section-head">
        <span>{label}</span>
        <button type="button" className="mcp-btn mcp-btn--secondary" onClick={() => onChange([...pairs, { key: '', value: '' }])}>+ 添加</button>
      </div>
      {pairs.map((pair, index) => (
        <div className="mcp-add-form__row" key={index}>
          <input className="mcp-add-form__input" aria-label={`${label}名称 ${index + 1}`} placeholder={keyPlaceholder} value={pair.key} onChange={event => update(index, { key: event.target.value })} />
          <input className="mcp-add-form__input mcp-add-form__input--wide" aria-label={`${label}值 ${index + 1}`} placeholder={valuePlaceholder} value={pair.value} onChange={event => update(index, { value: event.target.value })} />
          <button type="button" className="mcp-btn mcp-btn--danger" onClick={() => remove(index)}>移除</button>
        </div>
      ))}
      {pairs.length === 0 && <div className="mcp-add-form__empty">暂未添加</div>}
    </section>
  );
}
