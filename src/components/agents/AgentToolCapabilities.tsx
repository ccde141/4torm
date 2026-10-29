import { useState } from 'react';
import type { ToolDef } from '../../store/tools';
import { useLocale } from '../../i18n/LocaleContext';
import {
  getCapabilitySelectionState,
  groupAgentTools,
  toggleCapabilitySelection,
  toggleCapabilityTool,
  type AgentCapabilityGroup,
} from './agent-capability-groups';
import './AgentToolCapabilities.css';

export interface McpToolItem {
  name: string;
  fullName: string;
  description: string;
}

interface Props {
  allTools: ToolDef[];
  checkedTools: ReadonlySet<string>;
  mcpGroups: Record<string, McpToolItem[]>;
  onChange: (tools: Set<string>) => void;
}

function countSelected(group: AgentCapabilityGroup, selected: ReadonlySet<string>) {
  if (['tide', 'convection', 'cyclone'].includes(group.id)
    && getCapabilitySelectionState(group, selected) === 'on') return group.tools.length;
  return group.tools.filter(tool => selected.has(tool.name)).length;
}

export default function AgentToolCapabilities({
  allTools, checkedTools, mcpGroups, onChange,
}: Props) {
  const { t } = useLocale();
  const { capabilities, standalone } = groupAgentTools(allTools);
  const frameworkTools = standalone.filter(tool => tool.source === 'framework');
  const customTools = standalone.filter(tool => tool.source !== 'framework');

  const toggleTool = (name: string) => {
    const next = new Set(checkedTools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div className="agent-tool-capabilities">
      {allTools.length === 0 && Object.keys(mcpGroups).length === 0 && (
        <span className="agent-tool-capabilities__empty">{t('config.noTools')}</span>
      )}

      <CapabilitySection groups={capabilities} selected={checkedTools}
        onChange={onChange} />

      <StandaloneTools title={t('config.foundationTools')} tools={frameworkTools}
        selected={checkedTools} onToggle={toggleTool} />
      <StandaloneTools title={t('config.customTools')} tools={customTools}
        selected={checkedTools} onToggle={toggleTool} />

      <McpSection groups={mcpGroups} selected={checkedTools}
        onChange={onChange} onToggle={toggleTool} />
    </div>
  );
}

function CapabilitySection({ groups, selected, onChange }: {
  groups: AgentCapabilityGroup[];
  selected: ReadonlySet<string>;
  onChange: (tools: Set<string>) => void;
}) {
  const { t } = useLocale();
  if (groups.length === 0) return null;
  return <section className="agent-tool-section">
    <div className="agent-tool-section__heading">
      <strong>{t('config.frameworkCapabilities')}</strong>
      <span>{t('config.frameworkCapabilitiesHint')}</span>
    </div>
    <div className="agent-capability-list">{groups.map(group => {
      const state = getCapabilitySelectionState(group, selected);
      return <article key={group.id} className={`agent-capability-card agent-capability-card--${state}`}>
        <div className="agent-capability-card__head">
          <div className="agent-capability-card__copy"><strong>{group.title}</strong><span>{group.route}</span></div>
          <button type="button" className="agent-capability-card__toggle" data-state={state}
            aria-pressed={state === 'on'} onClick={() => onChange(toggleCapabilitySelection(group, selected))}>
            {t(state === 'on' ? 'config.capabilityOn'
              : state === 'partial' ? 'config.capabilityPartial' : 'config.capabilityOff')}
          </button>
        </div>
        <details className="agent-capability-card__details">
          <summary>{t('config.capabilityToolCount', {
            selected: countSelected(group, selected), count: group.tools.length,
          })}</summary>
          <div className="agent-tool-detail-list">{group.tools.map(tool =>
            group.id === 'tide' || group.id === 'convection'
              ? <div key={tool.name} className="agent-tool-row">
                <span className="agent-tool-row__name">{tool.name}</span>
                <span className="agent-tool-row__description">{tool.description}</span>
              </div>
              : <ToolRow key={tool.name} tool={tool}
                  checked={selected.has(tool.name) || selected.has(`framework_capability_${group.id}`)}
                  onToggle={name => onChange(toggleCapabilityTool(group, selected, name))} />)}
          </div>
        </details>
      </article>;
    })}</div>
  </section>;
}

function McpSection({ groups, selected, onChange, onToggle }: {
  groups: Record<string, McpToolItem[]>;
  selected: ReadonlySet<string>;
  onChange: (tools: Set<string>) => void;
  onToggle: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (Object.keys(groups).length === 0) return null;
  return <section className="agent-tool-section">
    <div className="agent-tool-section__heading"><strong>MCP</strong></div>
    {Object.entries(groups).map(([name, tools]) => <McpGroup key={name}
      name={name} tools={tools} selected={selected} expanded={expanded.has(name)}
      onExpand={() => {
        const next = new Set(expanded);
        if (next.has(name)) next.delete(name); else next.add(name);
        setExpanded(next);
      }} onChange={onChange} onToggle={onToggle} />)}
  </section>;
}

function McpGroup({ name, tools, selected, expanded, onExpand, onChange, onToggle }: {
  name: string; tools: McpToolItem[]; selected: ReadonlySet<string>; expanded: boolean;
  onExpand: () => void; onChange: (tools: Set<string>) => void; onToggle: (name: string) => void;
}) {
  const { t } = useLocale();
  const allSelected = tools.every(tool => selected.has(tool.fullName));
  const someSelected = tools.some(tool => selected.has(tool.fullName));
  const toggleAll = () => {
    const next = new Set(selected);
    tools.forEach(tool => allSelected ? next.delete(tool.fullName) : next.add(tool.fullName));
    onChange(next);
  };
  return <div className="agent-mcp-group">
    <button type="button" className="agent-mcp-group__head" onClick={onExpand}>
      <span>{expanded ? '▾' : '▸'}</span><strong>{name}</strong>
      <span>{t('config.toolCount', { count: tools.length })}</span>
    </button>
    <button type="button" className={`agent-mcp-group__toggle${someSelected ? ' is-active' : ''}`}
      onClick={toggleAll}>{t(allSelected ? 'config.allSelected' : 'config.selectAll')}</button>
    {expanded && <div className="agent-tool-detail-list agent-mcp-group__tools">{tools.map(tool =>
      <ToolRow key={tool.fullName} tool={{ name: tool.fullName, description: tool.description }}
        label={tool.name} checked={selected.has(tool.fullName)} onToggle={onToggle} />)}
    </div>}
  </div>;
}

function StandaloneTools({ title, tools, selected, onToggle }: {
  title: string; tools: ToolDef[]; selected: ReadonlySet<string>; onToggle: (name: string) => void;
}) {
  if (tools.length === 0) return null;
  return <section className="agent-tool-section">
    <div className="agent-tool-section__heading"><strong>{title}</strong></div>
    <div className="agent-tool-chip-list">
      {tools.map(tool => <button type="button" key={tool.name}
        className={`agent-tool-chip${selected.has(tool.name) ? ' is-active' : ''}`}
        title={tool.description || tool.name} onClick={() => onToggle(tool.name)}>
        {selected.has(tool.name) ? '✓ ' : ''}{tool.name}{tool.dangerous ? ' ⚠' : ''}
      </button>)}
    </div>
  </section>;
}

function ToolRow({ tool, label, checked, onToggle }: {
  tool: Pick<ToolDef, 'name' | 'description'>;
  label?: string;
  checked: boolean;
  onToggle: (name: string) => void;
}) {
  return <label className="agent-tool-row">
    <input type="checkbox" checked={checked} onChange={() => onToggle(tool.name)} />
    <span className="agent-tool-row__name">{label ?? tool.name}</span>
    <span className="agent-tool-row__description">{tool.description}</span>
  </label>;
}
