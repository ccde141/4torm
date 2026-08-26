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
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            className={`config-btn ${value === option.value ? 'config-btn-save' : 'config-btn-cancel'}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="config-hint" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
        {description}
      </div>
    </div>
  );
}
