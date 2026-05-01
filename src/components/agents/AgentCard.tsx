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
  onDelete?: (id: string) => void;
  onToolPerm?: (agent: Agent) => void;
}

export default function AgentCard({ agent, onClick, onConfig, onDelete, onToolPerm }: AgentCardProps) {
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
    getStatusColor(agent.status).then(setDotColor);
    getStatusLabel(agent.status).then(setDisplayLabel);
  }, [agent.model, agent.status]);

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
      {onToolPerm && (
        <button className="agent-card__perm-btn" title="工具权限" onClick={e => { e.stopPropagation(); onToolPerm(agent); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
        <div className="agent-card__meta-item">
          <span className="agent-card__meta-label">完成任务</span>
          <span className="agent-card__meta-value">{agent.tasksCompleted.toLocaleString()}</span>
        </div>
        <div className="agent-card__meta-item">
          <span className="agent-card__meta-label">模型</span>
          <span className="agent-card__meta-value" style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelName}</span>
        </div>
        {agent.config?.workspace && (
          <div className="agent-card__meta-item" style={{ flex: 1, minWidth: 0 }}>
            <span className="agent-card__meta-label">工作区</span>
            <span className="agent-card__meta-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}
              title={agent.config.workspace}
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(agent.config!.workspace!); }}
            >{agent.config.workspace}</span>
          </div>
        )}
        {onDelete && !confirmDelete && (
          <button onClick={e => { e.stopPropagation(); setConfirmDelete(true); }} style={{ padding: '2px var(--space-2)', background: 'transparent', color: 'var(--color-error)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', cursor: 'pointer', marginLeft: 'auto' }}>删除</button>
        )}
        {confirmDelete && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>确认删除?</span>
            <button onClick={e => { e.stopPropagation(); onDelete?.(agent.id); setConfirmDelete(false); }} style={{ padding: '1px var(--space-2)', background: 'var(--color-error)', color: 'var(--color-text-primary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>删除</button>
            <button onClick={e => { e.stopPropagation(); setConfirmDelete(false); }} style={{ padding: '1px var(--space-2)', background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
