import type { AgentPermissionLevel } from './agent-permission';
import { useLocale } from '../../i18n/LocaleContext';

interface Props {
  value: AgentPermissionLevel;
  onChange: (value: AgentPermissionLevel) => void;
}

export default function AgentPermissionField({ value, onChange }: Props) {
  const { t } = useLocale();
  const options: Array<{ value: AgentPermissionLevel; label: string }> = [
    { value: 'project', label: t('permission.project') },
    { value: 'unrestricted', label: t('permission.unrestricted') },
  ];
  const description = t(value === 'project' ? 'permission.projectHint' : 'permission.unrestrictedHint');

  return (
    <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
      <label className="config-label">{t('permission.label')}</label>
      <div className="agent-permission__options" role="group" aria-label={t('permission.label')}>
        {options.map(option => {
          const selected = value === option.value;
          return (
          <button
            key={option.value}
            type="button"
            className={`config-btn agent-permission__option${selected ? ' agent-permission__option--selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            <span className="agent-permission__mark" aria-hidden="true">{selected ? '✓' : ''}</span>
            {option.label}
          </button>
          );
        })}
      </div>
      <div className="config-hint" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
        {description}
      </div>
    </div>
  );
}
