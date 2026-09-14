import { useEffect, useRef, useState } from 'react';
import { listModels, probeAndStore, probeVisionAndStore, providerSelectionPatch, updateProvider, type ProviderCatalog, type ProviderEntry } from '../../llm';
import { retainProviderCapabilities, type ModelCapability } from '../../llm/model-capabilities';
import { retainModelProfiles } from '../../llm/provider-profiles';
import { useLocale } from '../../i18n/LocaleContext';
import { ModelCapabilityPanel } from './ModelCapabilityPanel';
import { ProviderConfigurationForm } from './ProviderConfigurationForm';
import { ProviderCustomParametersForm } from './ProviderCustomParametersForm';

export function ProviderCard({ provider: p, catalog, highlight, onChange, onRemove, onRefresh }: {
  provider: ProviderEntry; catalog: ProviderCatalog | null; highlight?: boolean;
  onChange: (id: string, field: keyof ProviderEntry, value: string) => void;
  onRemove: (id: string) => void; onRefresh: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const enterMotionRef = useRef(highlight ? 'mo-spring-in' : 'provider-detail-enter');
  useEffect(() => { if (highlight) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [highlight]);
  return <div ref={rootRef} className={`capability-panel provider-detail-card ${enterMotionRef.current}`} style={highlight ? highlightedCardStyle : cardStyle}>
    <ProviderHeader provider={p} onChange={onChange} onRemove={onRemove} />
    <ProviderConnection provider={p} catalog={catalog} onChange={onChange} onRefresh={onRefresh} />
    <div className="provider-detail-divider" />
    <ProviderModelsAndTests provider={p} onRefresh={onRefresh} />
  </div>;
}

function ProviderHeader({ provider: p, onChange, onRemove }: {
  provider: ProviderEntry;
  onChange: (id: string, field: keyof ProviderEntry, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useLocale();
  const [label, setLabel] = useState(p.label);
  useEffect(() => setLabel(p.label), [p.label]);
  return <div className="provider-detail-header" style={cardHeaderStyle}>
    <div style={{ position: 'relative', flex: 1 }}><input value={label} onChange={event => setLabel(event.target.value)} onBlur={() => { if (label !== p.label) onChange(p.id, 'label', label); }} placeholder={t('model.provider.unnamed')} style={{ ...inputStyle, fontWeight: 'var(--font-semibold)', width: 'auto', minWidth: '120px' }} /><span style={editHintStyle}>{t('model.provider.editName')}</span></div>
    <button className="capability-button capability-button--danger provider-danger-action" onClick={() => onRemove(p.id)} style={removeBtnStyle}>{t('model.provider.delete')}</button>
  </div>;
}

function ProviderConnection({ provider: p, catalog, onChange, onRefresh }: {
  provider: ProviderEntry; catalog: ProviderCatalog | null;
  onChange: (id: string, field: keyof ProviderEntry, value: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const descriptor = catalog?.providers.find(provider => provider.id === p.providerType);
  return <><div className="provider-basic-fields">{catalog && <ProviderTypeField provider={p} catalog={catalog} onRefresh={onRefresh} />}<label style={fieldLabel}>{t('model.provider.apiUrl')}</label><input value={p.baseUrl} onChange={event => onChange(p.id, 'baseUrl', event.target.value)} style={inputStyle} placeholder="http://localhost:1234/v1" /><label style={fieldLabel}>API Key</label><input type="password" value={p.apiKey} onChange={event => onChange(p.id, 'apiKey', event.target.value)} style={inputStyle} placeholder={t('model.provider.apiKeyEmpty')} /></div>
    <SchemaDisclosure provider={p} providerLabel={descriptor?.label ?? p.label} configuration={descriptor?.configuration} onRefresh={onRefresh} /></>;
}

function ProviderModelsAndTests({ provider: p, onRefresh }: { provider: ProviderEntry; onRefresh: () => void }) {
  const { t } = useLocale();
  const models = useProviderModels(p, onRefresh);
  const capabilities = useCapabilityTests(p, onRefresh);
  return <><div className="provider-models-heading"><div><strong>{t('model.provider.modelsAndTests')}</strong><span>{t('model.provider.modelsAndTestsHint')}</span></div><button className="capability-button capability-button--secondary provider-secondary-action provider-fetch-action" data-loading={models.testing} onClick={models.fetchModels} disabled={models.testing} style={smallBtnStyle}>{models.testing ? t('model.provider.fetching') : models.fetched.length ? t('model.provider.refetch') : t('model.provider.fetch')}</button></div>
    {models.fetched.length > 0 && <ModelPicker models={models.fetched} checked={models.checked} hasChange={models.hasChange} onToggle={models.toggle} onAll={models.selectAll} onClear={models.clear} onConfirm={models.confirm} />}
    {p.models.length > 0 && <ModelCapabilityPanel provider={p} probing={capabilities.probing} messages={capabilities.messages} onProbe={capabilities.probe} onRemove={models.remove} />}
    <div style={{ marginTop: 'var(--space-3)' }}><div style={fieldLabel}>{t('model.provider.manual')}</div><div style={{ display: 'flex', gap: 'var(--space-2)' }}><input value={models.manual} onChange={event => models.setManual(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') models.add(); }} placeholder={t('model.provider.modelPlaceholder')} style={{ ...inputStyle, flex: 1 }} /><button className="capability-button capability-button--primary provider-primary-action" onClick={models.add} style={primarySmallButton}>{t('model.provider.add')}</button></div></div>
    {models.error && <div className="provider-error-reveal" style={errorStyle}>{t('model.provider.fetchHint', { error: models.error })}</div>}</>;
}

function useProviderModels(p: ProviderEntry, onRefresh: () => void) {
  const { t } = useLocale();
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState('');
  const add = async () => { const name = manual.trim(); if (!name) return; if (!p.models.includes(name)) await updateProvider(p.id, { models: [...p.models, name] }); setManual(''); onRefresh(); };
  const remove = async (model: string) => { const models = p.models.filter(item => item !== model); await updateProvider(p.id, { models, modelProfiles: retainModelProfiles(p.modelProfiles, models), ...retainProviderCapabilities(p, models) }); onRefresh(); };
  const fetchModels = async () => {
    if (!p.baseUrl) return; setTesting(true); setError('');
    try { const response = await listModels({ baseUrl: p.baseUrl, apiKey: p.apiKey, headers: p.customHeaders, protocol: p.protocol }); const ids = response.data.map(model => model.id); setFetched(ids); setChecked(new Set(ids)); }
    catch (cause) { setFetched([]); setChecked(new Set()); setError(cause instanceof Error ? cause.message : t('model.provider.fetchFailed')); }
    finally { setTesting(false); }
  };
  const confirm = async () => { const models = [...checked]; await updateProvider(p.id, { models, modelProfiles: retainModelProfiles(p.modelProfiles, models), ...retainProviderCapabilities(p, models) }); setFetched([]); onRefresh(); };
  const toggle = (model: string) => setChecked(current => { const next = new Set(current); if (next.has(model)) next.delete(model); else next.add(model); return next; });
  return { testing, error, fetched, checked, manual, setManual, add, remove, fetchModels, confirm, toggle,
    selectAll: () => setChecked(new Set(fetched)), clear: () => setChecked(new Set()),
    hasChange: fetched.length > 0 && (p.models.length !== checked.size || !p.models.every(model => checked.has(model))) };
}

function useCapabilityTests(p: ProviderEntry, onRefresh: () => void) {
  const { t } = useLocale();
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const probe = async (model: string, capability: ModelCapability) => {
    const key = `${capability}:${model}`; setProbing(previous => new Set(previous).add(key));
    try {
      let message: string;
      if (capability === 'tools') {
        const result = await probeAndStore(p.id, model);
        message = result.status === 'native-confirmed' ? t('model.capability.toolsConfirmed') : result.error || (result.status === 'text-required' ? t('model.capability.toolsRejected') : t('model.capability.inconclusive'));
      } else {
        const result = await probeVisionAndStore(p.id, model);
        message = result.status === 'supported' ? t('model.capability.visionConfirmed') : result.error || t('model.capability.inconclusive');
      }
      setMessages(current => ({ ...current, [key]: message }));
    } catch (cause) { setMessages(current => ({ ...current, [key]: cause instanceof Error ? cause.message : t('model.capability.failed') })); }
    finally { setProbing(previous => { const next = new Set(previous); next.delete(key); return next; }); onRefresh(); }
  };
  return { probing, messages, probe };
}

function SchemaDisclosure({ provider, providerLabel, configuration, onRefresh }: {
  provider: ProviderEntry;
  providerLabel: string;
  configuration?: NonNullable<ProviderCatalog['providers'][number]['configuration']>;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const count = (configuration?.sections.reduce((total, section) => total + section.fields.length, 0) ?? 0)
    + (provider.customParameterDefinitions?.length ?? 0);
  return <div className="provider-schema-disclosure">
    <button type="button" className="provider-schema-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><strong>{t('model.provider.schemaToggle', { provider: providerLabel })}</strong><small>{t('model.provider.schemaHint', { count })}</small></span>
      <span aria-hidden="true">{open ? '−' : '＋'}</span>
    </button>
    {open && <div className="provider-schema-expanded">
      {configuration && <ProviderConfigurationForm provider={provider} configuration={configuration} onRefresh={onRefresh} />}
      <ProviderCustomParametersForm provider={provider} onRefresh={onRefresh} />
    </div>}
  </div>;
}

function ProviderTypeField({ provider: p, catalog, onRefresh }: { provider: ProviderEntry; catalog: ProviderCatalog; onRefresh: () => void }) {
  const { t } = useLocale();
  const providers = catalog.providers.filter(provider => provider.selectable || provider.id === p.providerType);
  const changeType = async (providerType: string) => {
    await updateProvider(p.id, providerSelectionPatch(catalog, providerType));
    onRefresh();
  };
  return <><label style={fieldLabel}>{t('model.provider.type')}</label><select className="provider-type-select" value={p.providerType ?? ''} onChange={event => changeType(event.target.value)} style={{ ...inputStyle, marginBottom: 'var(--space-2)' }}><option value="" disabled>{t('model.provider.typeLegacy')}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></>;
}

function ModelPicker({ models, checked, hasChange, onToggle, onAll, onClear, onConfirm }: { models: string[]; checked: Set<string>; hasChange: boolean; onToggle: (model: string) => void; onAll: () => void; onClear: () => void; onConfirm: () => void }) {
  const { t } = useLocale();
  return <div className="provider-model-picker" style={{ marginTop: 'var(--space-3)' }}><div style={pickerHeaderStyle}><span style={fieldLabel}>{t('model.provider.selectModels', { selected: checked.size, total: models.length })}</span><div><button className="capability-button capability-button--secondary capability-button--compact provider-inline-action" onClick={onAll} style={tinyBtnStyle}>{t('model.provider.selectAll')}</button><button className="capability-button capability-button--secondary capability-button--compact provider-inline-action" onClick={onClear} style={tinyBtnStyle}>{t('model.provider.clear')}</button><button className="capability-button capability-button--secondary capability-button--compact provider-inline-action" onClick={onConfirm} style={{ ...tinyBtnStyle, color: hasChange ? 'var(--color-accent)' : undefined }}>{t('model.provider.confirm')}</button></div></div><div className="provider-model-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{models.map(model => <button className="provider-model-tag" key={model} onClick={() => onToggle(model)} style={modelTagStyle}>{checked.has(model) ? '✓ ' : ''}{model}</button>)}</div></div>;
}

const cardStyle: React.CSSProperties = { padding: 'var(--space-4)' };
const highlightedCardStyle = { ...cardStyle, border: '1px solid var(--color-accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent)' };
const cardHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-1) var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' };
const editHintStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-1)' };
const removeBtnStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)' };
const smallBtnStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-3)' };
const primarySmallButton = { ...smallBtnStyle };
const tinyBtnStyle: React.CSSProperties = { ...smallBtnStyle, padding: '0 var(--space-2)', marginLeft: 'var(--space-1)', fontSize: 'var(--text-xs)' };
const pickerHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' };
const modelTagStyle: React.CSSProperties = { padding: '1px 6px', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' };
const errorStyle: React.CSSProperties = { marginTop: 'var(--space-2)', color: '#f87171', fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' };
