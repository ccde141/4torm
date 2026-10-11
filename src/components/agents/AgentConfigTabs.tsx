import { useLocale } from '../../i18n/LocaleContext';

export const AGENT_CONFIG_TABS = ['basic', 'prompt', 'tools', 'skills'] as const;
export type AgentConfigTab = typeof AGENT_CONFIG_TABS[number];

export const AGENT_CONFIG_TAB_LABELS = {
  basic: 'agent.tabBasic',
  prompt: 'agent.tabPrompt',
  tools: 'agent.tabTools',
  skills: 'agent.tabSkills',
} as const;

export function isAgentConfigTab(value: string): value is AgentConfigTab {
  return (AGENT_CONFIG_TABS as readonly string[]).includes(value);
}

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
        }}>{t(AGENT_CONFIG_TAB_LABELS[tab])}</button>
      ))}
    </div>
  );
}
