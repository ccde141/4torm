import type { AgentPermissionLevel } from './agent-permission';

interface Props {
  value: AgentPermissionLevel;
  onChange: (value: AgentPermissionLevel) => void;
}

const OPTIONS: Array<{ value: AgentPermissionLevel; label: string }> = [
  { value: 'project', label: '项目级' },
  { value: 'unrestricted', label: '无限制' },
];

export default function AgentPermissionField({ value, onChange }: Props) {
  const description = value === 'project'
    ? '文件工具可访问 4torm 项目和当前工作区，无论工作区位于何处；其他外部路径会被拒绝。'
    : '文件工具可访问任意路径；框架管理数据仍需通过专用工具修改。';

  return (
    <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
      <label className="config-label">执行权限</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {OPTIONS.map(option => (
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
