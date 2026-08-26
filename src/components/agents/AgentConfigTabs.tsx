import { useLocale } from '../../i18n/LocaleContext';

const AGENT_CONFIG_TABS = ['basic', 'prompt', 'skills'] as const;
export type AgentConfigTab = typeof AGENT_CONFIG_TABS[number];

const TAB_LABELS = {
  basic: 'agent.tabBasic',
  prompt: 'agent.tabPrompt',
  skills: 'agent.tabSkills',
} as const;

interface Props {
  active: AgentConfigTab;
  onChange: (tab: AgentConfigTab) => void;
}

export default function AgentConfigTabs({ active, onChange }: Props) {
  const { t } = useLocale();
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 var(--space-5)' }}>
      {AGENT_CONFIG_TABS.map(tab => (
        <button key={tab} onClick={() => onChange(tab)} style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'none', border: 'none',
          borderBottom: active === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
          color: active === tab ? 'var(--color-text)' : 'var(--color-text-tertiary)',
          fontSize: 'var(--text-sm)', fontWeight: active === tab ? 'var(--font-semibold)' : 'var(--font-normal)',
          cursor: 'pointer', marginBottom: '-1px',
        }}>{t(TAB_LABELS[tab])}</button>
      ))}
    </div>
  );
}
