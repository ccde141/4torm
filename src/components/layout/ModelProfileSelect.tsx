import {
  PROVIDER_PROFILE_OPTIONS,
  type ProviderProfileSelection,
} from '../../llm/provider-profiles';

interface ModelProfileSelectProps {
  value: ProviderProfileSelection;
  onChange(value: ProviderProfileSelection): void;
}

export function ModelProfileSelect({ value, onChange }: ModelProfileSelectProps) {
  return (
    <select
      aria-label="模型协议"
      title="请求协议；自动识别不正确时再手动选择"
      value={value}
      onChange={event => onChange(event.target.value as ProviderProfileSelection)}
      style={{
        maxWidth: '132px',
        padding: '1px 3px',
        border: '1px solid var(--border-color)',
        borderRadius: '3px',
        background: 'var(--color-bg)',
        color: 'var(--color-text-secondary)',
        fontSize: '10px',
      }}
    >
      {PROVIDER_PROFILE_OPTIONS.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}
