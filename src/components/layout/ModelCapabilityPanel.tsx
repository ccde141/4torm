import type { ProviderEntry } from '../../llm';
import { readModelCapability, type ModelCapability } from '../../llm/model-capabilities';
import { ModelProfileSelect } from './ModelProfileSelect';
import type { ProviderProfileSelection } from '../../llm/provider-profiles';
import { useLocale } from '../../i18n/LocaleContext';

interface Props {
  provider: ProviderEntry;
  probing: ReadonlySet<string>;
  messages: Readonly<Record<string, string>>;
  onProbe: (model: string, capability: ModelCapability) => void;
  onProfileChange: (model: string, profile: ProviderProfileSelection) => void;
  onRemove: (model: string) => void;
}

function probeKey(model: string, capability: ModelCapability) {
  return `${capability}:${model}`;
}

function CapabilityCell({ provider, model, capability, probing, message, onProbe }: {
  provider: ProviderEntry;
  model: string;
  capability: ModelCapability;
  probing: boolean;
  message?: string;
  onProbe: () => void;
}) {
  const { t } = useLocale();
  const result = readModelCapability(provider, model, capability);
  const status = probing ? t('model.capability.analyzing') : result?.status === 'supported'
    ? t('model.capability.supported') : result?.status === 'unsupported' ? t('model.capability.unsupported') : t('model.capability.unknown');
  const color = probing || !result ? 'var(--color-text-tertiary)'
    : result.status === 'supported' ? '#34d399' : '#f87171';

  return (
    <div style={{ minWidth: '112px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '24px' }}>
        <span className="provider-probe-dot" data-active={probing} aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ color, fontSize: 'var(--text-xs)', minWidth: '36px' }}>{status}</span>
        <button
          type="button"
          disabled={probing}
          onClick={onProbe}
          className="capability-button capability-button--secondary capability-button--compact provider-probe-action"
          title={t('model.capability.probeTitle', { capability: capability === 'vision' ? t('model.capability.vision') : t('model.capability.tools') })}
          style={probeButtonStyle}
        >
          {probing ? t('model.capability.probing') : t('model.capability.probe')}
        </button>
      </div>
      {message && (
        <div className="provider-capability-message" title={message} style={{ marginTop: '2px', maxWidth: '180px', color: 'var(--color-text-tertiary)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message}
        </div>
      )}
    </div>
  );
}

export function ModelCapabilityPanel({ provider, probing, messages, onProbe, onProfileChange, onRemove }: Props) {
  const { t } = useLocale();
  return (
    <section className="provider-capability-panel" style={{ marginTop: 'var(--space-3)' }}>
      <div style={{ marginBottom: 'var(--space-1)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)' }}>
        {t('model.capability.title', { count: provider.models.length })}
      </div>
      <div style={{ borderTop: '1px solid var(--border-color)' }}>
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(112px, auto)', gap: 'var(--space-2)', padding: '6px 0 2px', color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
          <span>{t('model.capability.configuration')}</span>
          <span>{t('model.capability.vision')}</span>
        </div>
        {provider.models.map(model => (
          <div
            key={model}
            className="provider-capability-row"
            style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(112px, auto)', gap: 'var(--space-2)', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span title={model} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)', fontSize: 'var(--text-xs)' }}>
                {model}
              </span>
              <ModelProfileSelect
                value={provider.modelProfiles?.[model] ?? 'auto'}
                onChange={profile => onProfileChange(model, profile)}
              />
              <button className="capability-icon-button capability-button--danger provider-remove-model" type="button" onClick={() => onRemove(model)} title={t('model.capability.remove')} aria-label={t('model.capability.remove')} style={removeButtonStyle}>×</button>
            </div>
            <CapabilityCell
              provider={provider}
              model={model}
              capability="vision"
              probing={probing.has(probeKey(model, 'vision'))}
              message={messages[probeKey(model, 'vision')]}
              onProbe={() => onProbe(model, 'vision')}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

const probeButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '10px',
  lineHeight: '16px',
};

const removeButtonStyle: React.CSSProperties = {
  padding: 0,
  fontSize: '14px',
  lineHeight: 1,
  flexShrink: 0,
};
