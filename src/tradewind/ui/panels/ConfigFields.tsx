import { useEffect, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { AGENTS_CHANGED_EVENT } from '../../../store/agent-events';
import { useLocale } from '../../../i18n/LocaleContext';
import { listTradewindAgents, type TradewindAgentSummary } from '../agent-client';

interface ConfigFieldsProps {
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  label: string;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  nodes: Node[];
  edges: Edge[];
  currentNodeId: string;
  onSyncReworkEdge: (gateNodeId: string, targetNodeId: string | null) => void;
}

// TODO(返工边): edges / onSyncReworkEdge 已透传，但 gate 配置控件尚未接线。
export function ConfigFields({ nodeId, nodeType, config, label, onUpdate, nodes,
  edges: _edges, currentNodeId, onSyncReworkEdge: _onSyncReworkEdge }: ConfigFieldsProps) {
  const { t } = useLocale();
  const update = (key: string, value: unknown) => {
    onUpdate(nodeId, { label, config: { ...config, [key]: value } });
  };
  switch (nodeType) {
    case 'agent': return <AgentFields config={config} onChange={update} />;
    case 'meeting': return <MeetingFields config={config} onChange={update} nodes={nodes} currentNodeId={currentNodeId} />;
    case 'note': return <NoteFields config={config} onChange={update} />;
    case 'human-gate': return <HumanGateFields />;
    case 'output': return <OutputFields config={config} onChange={update} />;
    case 'entry': return <EntryFields config={config} onChange={update} />;
    default: return <div className="tw-config__hint">{t('tradewind.config.none')}</div>;
  }
}

function useTradewindAgents(): { agents: TradewindAgentSummary[]; error: string } {
  const [agents, setAgents] = useState<TradewindAgentSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const data = await listTradewindAgents();
        if (!disposed) { setAgents(data); setError(''); }
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
      }
    };
    const refresh = () => { void load(); };
    void load();
    window.addEventListener(AGENTS_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener(AGENTS_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return { agents, error };
}

interface SimpleFieldProps {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

function AgentFields({ config, onChange }: SimpleFieldProps) {
  const { t } = useLocale();
  const { agents, error } = useTradewindAgents();
  const agentId = (config.agentId as string) ?? '';
  const role = (config.role as string) ?? '';
  return <>
    <div className="tw-config__field">
      <label className="tw-config__label">Agent</label>
      <select className="tw-config__select" value={agentId} onChange={e => onChange('agentId', e.target.value)}>
        <option value="">{t('tradewind.config.selectAgent')}</option>
        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id.slice(0, 12)})</option>)}
      </select>
      {error && <span className="tw-config__hint">{error}</span>}
    </div>
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.role')}</label>
      <input className="tw-config__input" placeholder={t('tradewind.config.rolePlaceholder')}
        value={role} onChange={e => onChange('role', e.target.value)} />
      {!role && <span className="tw-config__hint">{t('tradewind.config.defaultRole')}</span>}
    </div>
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.delay')}</label>
      <input className="tw-config__input" type="number" min={0} step={1} placeholder="0"
        value={(config.deliveryDelaySec as number) ?? ''} onChange={e => {
          const value = e.target.value.trim();
          onChange('deliveryDelaySec', value === '' ? undefined : Math.max(0, Number(value)));
        }} />
      <span className="tw-config__hint">{t('tradewind.config.delayHint')}</span>
    </div>
  </>;
}

function MeetingFields({ config, onChange, nodes, currentNodeId }: SimpleFieldProps & {
  nodes: Node[]; currentNodeId: string;
}) {
  const { t } = useLocale();
  const { agents, error } = useTradewindAgents();
  const chairAgentId = (config.chairAgentId as string) ?? '';
  const participantNodeIds = (config.participantNodeIds as string[]) ?? [];
  const agentNodes = nodes.filter(node => node.type === 'agent' && node.id !== currentNodeId);
  const toggleParticipant = (id: string) => onChange('participantNodeIds', participantNodeIds.includes(id)
    ? participantNodeIds.filter(nodeId => nodeId !== id) : [...participantNodeIds, id]);
  return <>
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.chair')}</label>
      <select className="tw-config__select" value={chairAgentId} onChange={e => onChange('chairAgentId', e.target.value)}>
        <option value="">{t('tradewind.config.selectChair')}</option>
        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      {error && <span className="tw-config__hint">{error}</span>}
    </div>
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.participants')}</label>
      {agentNodes.length === 0 ? <div className="tw-config__hint">{t('tradewind.config.noAgentNodes')}</div> : (
        <div className="tw-config__checklist">{agentNodes.map(node => {
          const data = (node.data ?? {}) as Record<string, unknown>;
          const nodeLabel = (data.label as string) || node.id;
          return <label key={node.id} className="tw-config__check-item">
            <input type="checkbox" checked={participantNodeIds.includes(node.id)} onChange={() => toggleParticipant(node.id)} />
            <span>{nodeLabel}</span>
          </label>;
        })}</div>
      )}
    </div>
  </>;
}

function NoteFields({ config, onChange }: SimpleFieldProps) {
  const { t } = useLocale();
  const [content, setContent] = useState((config.content as string) ?? '');
  useEffect(() => setContent((config.content as string) ?? ''), [config.content]);
  return <div className="tw-config__field">
    <label className="tw-config__label">{t('tradewind.config.constraint')}</label>
    <textarea className="tw-config__textarea" rows={5} placeholder={t('tradewind.config.constraintPlaceholder')}
      value={content} onChange={e => setContent(e.target.value)} onBlur={() => onChange('content', content)} />
  </div>;
}

function HumanGateFields() {
  const { t } = useLocale();
  return <div className="tw-config__field"><div className="tw-config__hint">
    {t('tradewind.config.gateHint')}
  </div></div>;
}

function EntryFields({ config, onChange }: SimpleFieldProps) {
  const { t } = useLocale();
  const [envelope, setEnvelope] = useState((config.initialEnvelope as string) ?? '');
  useEffect(() => setEnvelope((config.initialEnvelope as string) ?? ''), [config.initialEnvelope]);
  return <div className="tw-config__field">
    <label className="tw-config__label">{t('tradewind.config.initialEnvelope')}</label>
    <textarea className="tw-config__textarea" rows={5} placeholder={t('tradewind.config.initialEnvelopePlaceholder')}
      value={envelope} onChange={e => setEnvelope(e.target.value)} onBlur={() => onChange('initialEnvelope', envelope)} />
    <div className="tw-config__hint">{t('tradewind.config.initialEnvelopeHint')}</div>
  </div>;
}

function OutputFields({ config, onChange }: SimpleFieldProps) {
  const { t } = useLocale();
  const [name, setName] = useState((config.archiveName as string) ?? '');
  useEffect(() => setName((config.archiveName as string) ?? ''), [config.archiveName]);
  return <div className="tw-config__field">
    <label className="tw-config__label">{t('tradewind.config.archiveName')}</label>
    <input className="tw-config__input" value={name} onChange={e => setName(e.target.value)}
      onBlur={() => onChange('archiveName', name)} onKeyDown={e => { if (e.key === 'Enter') onChange('archiveName', name); }}
      placeholder={t('tradewind.config.archivePlaceholder')} />
    <div className="tw-config__hint">{t('tradewind.config.archiveHint')}</div>
  </div>;
}
