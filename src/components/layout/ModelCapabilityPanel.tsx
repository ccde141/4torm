import type { ProviderEntry } from '../../llm';
import { readModelCapability, type ModelCapability } from '../../llm/model-capabilities';
import { ModelProfileSelect } from './ModelProfileSelect';
import type { ProviderProfileSelection } from '../../llm/provider-profiles';

interface Props {
  provider: ProviderEntry;
  probing: ReadonlySet<string>;
  messages: Readonly<Record<string, string>>;
  onProbe: (model: string, capability: ModelCapability) => void;
  onProfileChange: (model: string, profile: ProviderProfileSelection) => void;
  onRemove: (model: string) => void;
}

const capabilityLabels: Record<ModelCapability, string> = {
  tools: '工具调用',
  vision: '图片理解',
};

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
  const result = readModelCapability(provider, model, capability);
  const status = probing ? '分析中' : result?.status === 'supported'
    ? '支持' : result?.status === 'unsupported' ? '不支持' : '未分析';
  const color = probing || !result ? 'var(--color-text-tertiary)'
    : result.status === 'supported' ? '#34d399' : '#f87171';

  return (
    <div style={{ minWidth: '112px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '24px' }}>
        <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ color, fontSize: 'var(--text-xs)', minWidth: '36px' }}>{status}</span>
        <button
          type="button"
          disabled={probing}
          onClick={onProbe}
          title={`检测${capabilityLabels[capability]}能力`}
          style={probeButtonStyle}
        >
          {probing ? '检测中' : '检测'}
        </button>
      </div>
      {message && (
        <div title={message} style={{ marginTop: '2px', maxWidth: '180px', color: 'var(--color-text-tertiary)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message}
        </div>
      )}
    </div>
  );
}

export function ModelCapabilityPanel({ provider, probing, messages, onProbe, onProfileChange, onRemove }: Props) {
  return (
    <section style={{ marginTop: 'var(--space-3)' }}>
      <div style={{ marginBottom: 'var(--space-1)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)' }}>
        模型能力（{provider.models.length}）
      </div>
      <div style={{ borderTop: '1px solid var(--border-color)' }}>
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(112px, auto)', gap: 'var(--space-2)', padding: '6px 0 2px', color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
          <span>模型配置</span>
          <span>图片理解</span>
        </div>
        {provider.models.map(model => (
          <div
            key={model}
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
              <button type="button" onClick={() => onRemove(model)} title="移除模型" style={removeButtonStyle}>×</button>
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
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-secondary)',
  fontSize: '10px',
  lineHeight: '16px',
  cursor: 'pointer',
};

const removeButtonStyle: React.CSSProperties = {
  padding: '0 2px',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-tertiary)',
  fontSize: '14px',
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
};
