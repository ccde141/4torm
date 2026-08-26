import {
  PROVIDER_PROFILE_OPTIONS,
  type ProviderProfileSelection,
} from '../../llm/provider-profiles';
import { useLocale } from '../../i18n/LocaleContext';

interface ModelProfileSelectProps {
  value: ProviderProfileSelection;
  onChange(value: ProviderProfileSelection): void;
}

export function ModelProfileSelect({ value, onChange }: ModelProfileSelectProps) {
  const { t } = useLocale();
  const labels: Partial<Record<ProviderProfileSelection, string>> = {
    auto: t('model.profile.auto'),
    'openai-compatible': t('model.profile.openai'),
    'llama-cpp': t('model.profile.llamaCpp'),
    'zhipu-glm': t('model.profile.zhipu'),
    dashscope: t('model.profile.dashscope'),
    'siliconflow-thinking': t('model.profile.siliconflow'),
  };
  return (
    <select
      className="provider-model-profile-select"
      aria-label={t('model.profile.label')}
      title={t('model.profile.hint')}
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
        <option key={option.value} value={option.value}>{labels[option.value] ?? option.label}</option>
      ))}
    </select>
  );
}
