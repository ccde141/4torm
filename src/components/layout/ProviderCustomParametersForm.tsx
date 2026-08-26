import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import {
  customParameterText,
  defineCustomParameter,
  readCustomParameterDefinitions,
  removeCustomParameter,
  setCustomParameterFromText,
} from '../../llm/custom-provider-parameters';
import {
  updateProvider,
  type ProviderCustomParameterDefinition,
  type ProviderCustomParameterKind,
  type ProviderEntry,
} from '../../llm';
import './ProviderCustomParameters.css';

export function ProviderCustomParametersForm({ provider, onRefresh }: {
  provider: ProviderEntry;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<ProviderCustomParameterKind>('string');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');
  const storedDefinitions = readCustomParameterDefinitions(provider.customParameterDefinitions);
  const definitions = storedDefinitions.definitions;

  const addDefinition = async () => {
    try {
      const definition = defineCustomParameter(definitions, {
        path,
        label,
        kind,
        ...(kind === 'select' ? { options: options.split(',') } : {}),
      });
      await updateProvider(provider.id, {
        customParameterDefinitions: [...definitions, definition],
      });
      setPath('');
      setLabel('');
      setOptions('');
      setKind('string');
      setError('');
      onRefresh();
    } catch (cause) {
      setError(errorMessage(cause, t('model.provider.customSaveFailed')));
    }
  };

  const saveValue = async (definition: ProviderCustomParameterDefinition, text: string) => {
    try {
      const customRequestParameters = setCustomParameterFromText(
        provider.customRequestParameters ?? {}, definition, text,
      );
      await updateProvider(provider.id, { customRequestParameters });
      setError('');
      onRefresh();
    } catch (cause) {
      setError(errorMessage(cause, t('model.provider.customSaveFailed')));
    }
  };

  const removeDefinition = async (definition: ProviderCustomParameterDefinition) => {
    try {
      await updateProvider(provider.id, {
        customParameterDefinitions: definitions.filter(item => item.id !== definition.id),
        customRequestParameters: removeCustomParameter(
          provider.customRequestParameters ?? {}, definition.path,
        ),
      });
      setError('');
      onRefresh();
    } catch (cause) {
      setError(errorMessage(cause, t('model.provider.customSaveFailed')));
    }
  };

  return <section className="provider-custom-parameters">
    <header>
      <div><strong>{t('model.provider.customTitle')}</strong><small>{t('model.provider.customHint')}</small></div>
    </header>
    {definitions.length > 0 && <div className="provider-custom-list">
      {definitions.map(definition => <CustomParameterField
        key={`${definition.id}:${customParameterText(provider.customRequestParameters, definition)}`}
        definition={definition}
        initialValue={customParameterText(provider.customRequestParameters, definition)}
        onSave={saveValue}
        onRemove={removeDefinition}
      />)}
    </div>}
    {storedDefinitions.invalidCount > 0 && <div className="provider-custom-error" role="alert">{t('model.provider.customInvalidDefinitions', { count: storedDefinitions.invalidCount })}</div>}
    <div className="provider-custom-builder">
      <label><span>{t('model.provider.customPath')}</span><input value={path} onChange={event => setPath(event.target.value)} placeholder="reasoning_effort" /></label>
      <label><span>{t('model.provider.customLabel')}</span><input value={label} onChange={event => setLabel(event.target.value)} placeholder={t('model.provider.customLabelPlaceholder')} /></label>
      <label><span>{t('model.provider.customType')}</span><select value={kind} onChange={event => setKind(event.target.value as ProviderCustomParameterKind)}>{CUSTOM_KINDS.map(item => <option key={item} value={item}>{t(CUSTOM_KIND_LABELS[item])}</option>)}</select></label>
      {kind === 'select' && <label className="provider-custom-options"><span>{t('model.provider.customOptions')}</span><input value={options} onChange={event => setOptions(event.target.value)} placeholder="low, medium, high" /></label>}
      <button type="button" className="capability-button capability-button--secondary" onClick={addDefinition}>{t('model.provider.customAdd')}</button>
    </div>
    {error && <div className="provider-custom-error" role="alert">{error}</div>}
  </section>;
}

function CustomParameterField({ definition, initialValue, onSave, onRemove }: {
  definition: ProviderCustomParameterDefinition;
  initialValue: string;
  onSave: (definition: ProviderCustomParameterDefinition, text: string) => void;
  onRemove: (definition: ProviderCustomParameterDefinition) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(initialValue);
  const save = () => { if (value !== initialValue) onSave(definition, value); };
  return <div className="provider-custom-field">
    <label><span><strong>{definition.label}</strong><code>{definition.path}</code></span>
      {definition.kind === 'boolean'
        ? <select value={value} onChange={event => { setValue(event.target.value); onSave(definition, event.target.value); }}><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
        : definition.kind === 'select'
          ? <select value={value} onChange={event => { setValue(event.target.value); onSave(definition, event.target.value); }}><option value="">—</option>{definition.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : <input type={definition.kind === 'number' ? 'number' : 'text'} value={value} onChange={event => setValue(event.target.value)} onBlur={save} placeholder={definition.kind === 'json' ? '{"key":"value"}' : ''} />}
    </label>
    <button type="button" className="provider-custom-remove" onClick={() => onRemove(definition)} aria-label={t('model.provider.customRemove')}>×</button>
  </div>;
}

const CUSTOM_KINDS: ProviderCustomParameterKind[] = ['string', 'number', 'boolean', 'select', 'json'];
const CUSTOM_KIND_LABELS = {
  string: 'model.provider.customType.string',
  number: 'model.provider.customType.number',
  boolean: 'model.provider.customType.boolean',
  select: 'model.provider.customType.select',
  json: 'model.provider.customType.json',
} as const;

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
