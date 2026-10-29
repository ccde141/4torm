import { useEffect, useRef, useState } from 'react';
import { addProvider, fetchProviderCatalog, getAllModels, getProviders, providerSelectionPatch, removeProvider, updateProvider } from '../../llm';
import type { ProviderCatalog, ProviderEntry, ProviderPresetDescriptor } from '../../llm';
import { useLocale } from '../../i18n/LocaleContext';
import { ProviderCard } from './ProviderCard';
import { ProviderNavigator } from './ProviderNavigator';
import { selectionAfterProviderRemoval } from './provider-workspace-state';
import { useConfirm } from '../common/ConfirmDialog';
import '../../styles/components/capability-management.css';
import './ProviderWorkspace.css';
import './ProviderControls.css';

export default function SettingsPage() {
  const { t } = useLocale();
  const confirm = useConfirm();
  const removePending = useRef(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [allModels, setAllModels] = useState<{ key: string; label: string }[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refresh = () => { getProviders().then(setProviders); getAllModels().then(setAllModels); };
  useEffect(() => {
    refresh();
    fetchProviderCatalog().then(setCatalog).catch(() => { /* existing settings remain usable */ });
  }, []);

  const flagNew = (id: string) => {
    setHighlightId(id);
    window.setTimeout(() => setHighlightId(current => current === id ? null : current), 2400);
  };
  const addPreset = async (preset: ProviderPresetDescriptor) => {
    const selection = preset.providerType && catalog
      ? providerSelectionPatch(catalog, preset.providerType) : undefined;
    const entry = await addProvider(preset.label, preset.baseUrl, '', preset.protocol, selection);
    setShowPresets(false); setSelectedId(entry.id); refresh(); flagNew(entry.id);
  };
  const remove = async (id: string) => {
    const provider = providers.find(item => item.id === id);
    if (!provider || removePending.current) return;
    removePending.current = true;
    try {
      if (!(await confirm({
        title: t('model.provider.deleteTitle', { name: provider.label || t('model.provider.unnamed') }),
        message: t('model.provider.deleteMessage'),
        confirmText: t('model.provider.delete'), danger: true,
      }))) return;
      setRemovingId(id);
      setRemoveError('');
      await removeProvider(id);
      setProviders(current => current.filter(item => item.id !== id));
      setSelectedId(current => selectionAfterProviderRemoval(providers, current, id));
      setAllModels(await getAllModels());
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : t('model.provider.deleteFailed'));
    } finally {
      removePending.current = false;
      setRemovingId(null);
    }
  };
  const change = async (id: string, field: keyof ProviderEntry, value: string) => {
    await updateProvider(id, { [field]: value }); refresh();
  };

  const selectedProvider = providers.find(provider => provider.id === selectedId) ?? providers[0];

  return (
    <div className="capability-page" style={pageStyle}>
      <div className="capability-header" style={headerStyle}>
        <div className="capability-heading">
          <h2 className="capability-title" style={titleStyle}>{t('model.settings.title')}</h2>
          <p className="capability-subtitle" style={subtitleStyle}>{t('model.settings.subtitle')}</p>
          <p style={hintStyle}>{t('model.settings.protocolHint')}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="capability-button capability-button--primary" onClick={() => setShowPresets(value => !value)}>{t('model.settings.addProvider', { arrow: showPresets ? '▲' : '▼' })}</button>
          {showPresets && <PresetMenu presets={catalog?.presets ?? []} onPreset={addPreset} />}
        </div>
      </div>
      {providers.length === 0 && <div style={emptyStyle}>{t('model.settings.empty')}</div>}
      {removeError && <div className="capability-alert" role="alert">{removeError}</div>}
      {selectedProvider && <div className="model-provider-workspace">
        <ProviderNavigator providers={providers} catalog={catalog} selectedId={selectedProvider.id} onSelect={setSelectedId} />
        <main className="model-provider-detail">
          <ProviderCard key={selectedProvider.id} provider={selectedProvider} catalog={catalog}
            highlight={selectedProvider.id === highlightId} removing={removingId !== null} onChange={change} onRemove={remove} onRefresh={refresh} />
        </main>
      </div>}
      {allModels.length > 0 && (
        <div style={modelsStyle}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>{t('model.settings.registered', { count: allModels.length })}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>{allModels.map(model => <span key={model.key} style={tagStyle}>{model.label}</span>)}</div>
        </div>
      )}
    </div>
  );
}

function PresetMenu({ presets, onPreset }: { presets: ProviderPresetDescriptor[]; onPreset: (preset: ProviderPresetDescriptor) => void }) {
  return <div style={menuStyle}>
    {presets.map(preset => <button key={preset.id} onClick={() => onPreset(preset)} style={menuButtonStyle}>{preset.label}</button>)}
  </div>;
}

const pageStyle: React.CSSProperties = { padding: 'var(--space-6)', maxWidth: '1120px', margin: '0 auto', background: 'var(--glass-bg-soft)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))' };
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' };
const titleStyle: React.CSSProperties = { fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', margin: '0 0 var(--space-1) 0' };
const subtitleStyle: React.CSSProperties = { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 };
const hintStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', margin: 'var(--space-1) 0 0 0' };
const menuStyle: React.CSSProperties = { position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', zIndex: 10, minWidth: '200px', boxShadow: 'var(--shadow-md)' };
const menuButtonStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', color: 'var(--color-text)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)' };
const emptyStyle: React.CSSProperties = { textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textShadow: 'var(--text-halo)' };
const modelsStyle: React.CSSProperties = { marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' };
const tagStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' };
