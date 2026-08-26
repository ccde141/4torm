import { useState } from 'react';
import { updateProvider, type ProviderEntry } from '../../llm';
import {
  configurationPatch,
  configurationValue,
  parseConfigurationInput,
  validateConfigurationConstraints,
  type ConfigurationLocale,
} from '../../llm/provider-configuration';
import type {
  ProviderConfigurationField,
  ProviderConfigurationSchema,
  ProviderConfigurationValue,
} from '../../llm/provider-catalog';
import { useLocale } from '../../i18n/LocaleContext';

export function ProviderConfigurationForm({ provider, configuration, onRefresh }: {
  provider: ProviderEntry;
  configuration: ProviderConfigurationSchema;
  onRefresh: () => void;
}) {
  const { locale } = useLocale();
  const language: ConfigurationLocale = locale === 'zh-CN' ? 'zh' : 'en';
  return <section className="provider-configuration-form" style={panelStyle}>
    {configuration.sections.map(section => <div key={section.id} style={sectionStyle}>
      <div style={sectionTitleStyle}>{section.label[language]}</div>
      <div style={gridStyle}>{section.fields.map(field => {
        const value = configurationValue(provider, configuration.defaults, field.path);
        return <ConfigurationField key={`${provider.id}:${field.path}:${String(value)}`}
          provider={provider} configuration={configuration} field={field}
          value={value} language={language} onRefresh={onRefresh} />;
      })}</div>
    </div>)}
  </section>;
}

function ConfigurationField({ provider, configuration, field, value, language, onRefresh }: {
  provider: ProviderEntry;
  configuration: ProviderConfigurationSchema;
  field: ProviderConfigurationField;
  value: ProviderConfigurationValue | undefined;
  language: ConfigurationLocale;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));
  const [error, setError] = useState('');
  const save = async () => {
    const parsed = parseConfigurationInput(draft, field, language);
    if ('error' in parsed) return setError(parsed.error);
    const patch = configurationPatch(provider, field.path, parsed.value);
    const candidate = { ...provider, ...patch };
    const constraintError = validateConfigurationConstraints(candidate, configuration, language);
    if (constraintError) return setError(constraintError);
    try {
      await updateProvider(provider.id, patch as Partial<ProviderEntry>);
      setError('');
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('model.provider.configurationSaveFailed'));
    }
  };
  return <label style={fieldStyle}>
    <span style={fieldTitleStyle}>{field.label[language]}</span>
    {field.kind === 'select'
      ? <select value={draft} onChange={event => { setDraft(event.target.value); setError(''); }}
          onBlur={save} aria-invalid={Boolean(error)}
          style={{ ...inputStyle, borderColor: error ? '#f87171' : undefined }}>
          {field.nullable && <option value="">{t('model.provider.inheritServer')}</option>}
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label[language]}</option>)}
        </select>
      : <input type="number" inputMode="decimal" value={draft}
          min={field.min} max={field.max} step={field.kind === 'integer' ? 1 : field.step ?? 'any'}
          placeholder={field.nullable ? t('model.provider.inheritServer') : undefined}
          onChange={event => { setDraft(event.target.value); setError(''); }}
          onBlur={save} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          aria-invalid={Boolean(error)} style={{ ...inputStyle, borderColor: error ? '#f87171' : undefined }} />}
    <span style={descriptionStyle}>{field.description[language]}</span>
    {error && <span role="alert" style={errorStyle}>{error}</span>}
  </label>;
}

const panelStyle: React.CSSProperties = { paddingTop: 'var(--space-3)', background: 'transparent', borderTop: '1px solid var(--border-color)' };
const sectionStyle: React.CSSProperties = { marginTop: 'var(--space-3)' };
const sectionTitleStyle: React.CSSProperties = { marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)' };
const fieldStyle: React.CSSProperties = { display: 'flex', minWidth: 0, flexDirection: 'column', gap: '4px' };
const fieldTitleStyle: React.CSSProperties = { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-1) var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-sm)' };
const descriptionStyle: React.CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: '11px', lineHeight: 1.4 };
const errorStyle: React.CSSProperties = { color: '#f87171', fontSize: '11px', lineHeight: 1.4 };
