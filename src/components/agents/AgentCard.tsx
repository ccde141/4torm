import { useState, useEffect } from 'react';
import { getAllModels } from '../../llm';
import { checkModelAvailable } from '../../store/agent';
import { getStatusColor, getStatusLabel } from '../../store/statuses';
import type { Agent } from '../../types';
import '../../styles/components/agent-card.css';

interface AgentCardProps {
  agent: Agent;
  onClick?: (agent: Agent) => void;
  onConfig?: (agent: Agent) => void;
  onMemory?: (agent: Agent) => void;
  onDelete?: (id: string) => void;
}

export default function AgentCard({ agent, onClick, onConfig, onMemory, onDelete }: AgentCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [modelName, setModelName] = useState('');
  const [dotColor, setDotColor] = useState('#6b7280');
  const [displayLabel, setDisplayLabel] = useState('');

  useEffect(() => {
    if (agent.model) {
      checkModelAvailable(agent.model).then(setModelAvailable);
    } else {
      setModelAvailable(false);
    }
    getAllModels().then(models => {
      const m = models.find(o => o.key === agent.model);
      setModelName(m?.label || agent.model || '未选择');
    });
    getStatusColor(agent.busy ? 'busy' : agent.status).then(setDotColor);
    getStatusLabel(agent.busy ? 'busy' : agent.status).then(label => {
      setDisplayLabel(agent.label ? `${label} · ${agent.label}` : label);
    });
  }, [agent.model, agent.status, agent.busy]);

  const effectiveColor = (agent.status === 'idle' || !agent.status) && modelAvailable === false
    ? 'var(--color-error)'
    : dotColor;

  return (
    <div className="agent-card" onClick={() => onClick?.(agent)} style={{ position: 'relative' }}>
      <div
        title={displayLabel}
        style={{
          position: 'absolute',
          top: 'var(--space-3)',
          left: 'var(--space-3)',
          width: 10, height: 10, borderRadius: '50%',
          background: effectiveColor,
          boxShadow: `0 0 6px ${effectiveColor}80`,
        }}
      />
      {onConfig && (
        <button className="agent-card__config-btn" title="配置 Agent" onClick={e => { e.stopPropagation(); onConfig(agent); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
      {onMemory && (
        <button className="agent-card__memory-btn" title="长期记忆" onClick={e => { e.stopPropagation(); onMemory(agent); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.04Z" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.04Z" />
          </svg>
        </button>
      )}
      <div className="agent-card__header" style={{ paddingLeft: 'var(--space-3)' }}>
        <div className="agent-card__avatar">{agent.name[0]}</div>
        <div className="agent-card__info">
          <div className="agent-card__name">{agent.name}</div>
          <div className="agent-card__role">{agent.role}</div>
        </div>
      </div>
      <p className="agent-card__description">{agent.description}</p>
      <div className="agent-card__meta">
        <div className="agent-card__meta-row">
          <span className="agent-card__meta-label">模型</span>
          <span className="agent-card__meta-value agent-card__meta-value--ellipsis" title={modelName}>{modelName}</span>
        </div>
        {agent.config?.workspace && (
          <div className="agent-card__meta-row">
            <span className="agent-card__meta-label">工作区</span>
            <span
              className="agent-card__meta-value agent-card__workspace"
              title={`${agent.config.workspace}（点击复制）`}
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(agent.config!.workspace!); }}
            >{agent.config.workspace}</span>
          </div>
        )}
        {onDelete && !confirmDelete && (
          <button
            className="agent-card__delete-btn"
            onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
          >删除</button>
        )}
        {confirmDelete && (
          <div className="agent-card__delete-confirm">
            <span>工作区与对话信息将被清空，确认删除?</span>
            <button
              className="agent-card__delete-yes"
              onClick={e => { e.stopPropagation(); onDelete?.(agent.id); setConfirmDelete(false); }}
            >删除</button>
            <button
              className="agent-card__delete-no"
              onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
            >取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
