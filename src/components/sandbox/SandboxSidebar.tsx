import { useState, useEffect } from 'react';
import type { SandboxWorkflow, SandboxNodeType } from '../../types/sandbox';
import type { Agent } from '../../types';
import { getWorkflows, createWorkflow, saveWorkflow, deleteWorkflow } from '../../store/sandbox';
import { getAgents } from '../../store/agent';

interface Props {
  activeWorkflowId: string | null;
  onSelectWorkflow: (name: string) => void;
  onNewWorkflow: () => void;
  activeAgentIds: string[];
  onToggleAgent: (agentId: string) => void;
  customPalette?: Array<{ type: string; label: string; icon: string; color: string }>;
}

const NODE_PALETTE: Array<{ type: SandboxNodeType; label: string; icon: string; color: string }> = [
  { type: 'entry', label: '入口', icon: '⬇', color: '#6b7280' },
  { type: 'agent', label: 'AI Agent', icon: '🤖', color: '#7c3aed' },
  { type: 'condition', label: '条件分支', icon: '◇', color: '#fbbf24' },
  { type: 'merge', label: '合并', icon: '⊕', color: '#f59e0b' },
  { type: 'fork', label: '分叉', icon: '⑂', color: '#3b82f6' },
  { type: 'variable', label: '变量', icon: '📦', color: '#8b5cf6' },
  { type: 'human-gate', label: '人工确认', icon: '👤', color: '#fbbf24' },
  { type: 'error-handler', label: '错误处理', icon: '⚠', color: '#ef4444' },
  { type: 'output', label: '输出', icon: '💾', color: '#22c55e' },
  { type: 'group', label: '分组', icon: '▦', color: '#7c3aed' },
  { type: 'note', label: '备注', icon: '📝', color: '#fbbf24' },
];

export default function SandboxSidebar({
  activeWorkflowId, onSelectWorkflow, onNewWorkflow,
  activeAgentIds, onToggleAgent, customPalette,
}: Props) {
  const [workflows, setWorkflows] = useState<SandboxWorkflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    getWorkflows().then(setWorkflows);
    getAgents().then(setAgents);
  }, []);

  const handleCreate = async () => {
    if (!wfName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const wf = await createWorkflow(wfName.trim(), wfDesc.trim());
      setWorkflows(prev => [...prev, wf]);
      setWfName('');
      setWfDesc('');
      onSelectWorkflow(wf.name);
    } catch (err: any) {
      setCreateError(err?.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm('确定删除此工作流？')) return;
    const target = workflows.find(w => w.name === name);
    if (!target) return;
    await deleteWorkflow(target.id);
    setWorkflows(prev => prev.filter(w => w.name !== name));
    if (target.id === activeWorkflowId) onNewWorkflow();
  };

  const handleSelect = (name: string) => {
    onSelectWorkflow(name);
  };

  const handleDragStart = (e: React.DragEvent, type: SandboxNodeType) => {
    e.dataTransfer.setData('application/sandbox-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="sandbox-sidebar">
      {/* New workflow */}
      <div className="sandbox-sidebar-section">
        <div className="sandbox-sidebar-label">新建工作流</div>
        <input
          className="sandbox-input"
          placeholder="工作流名称"
          value={wfName}
          onChange={e => setWfName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && wfName.trim() && handleCreate()}
        />
        <input
          className="sandbox-input"
          placeholder="描述（可选）"
          value={wfDesc}
          onChange={e => setWfDesc(e.target.value)}
          style={{ marginTop: '6px' }}
        />
        {createError && (
          <div style={{ marginTop: '6px', fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
            {createError}
          </div>
        )}
        <button
          className="sandbox-btn sandbox-btn-primary"
          onClick={handleCreate}
          disabled={creating}
          style={{ marginTop: '6px' }}
        >
          {creating ? '创建中...' : '创建 +'}
        </button>
      </div>

      {/* Workflow list */}
      <div className="sandbox-sidebar-section" style={{ flex: '0 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="sandbox-sidebar-label">工作流列表</div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {workflows.length === 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-2)' }}>
              暂无工作流
            </div>
          )}
          {workflows.map(wf => (
            <div
              key={wf.id}
              className={`sandbox-wf-item${activeWorkflowId === wf.id ? ' sandbox-wf-item--active' : ''}`}
              onClick={() => handleSelect(wf.name)}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wf.name}
              </span>
              <button
                className="sandbox-wf-delete"
                onClick={e => { e.stopPropagation(); handleDelete(wf.name); }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Node palette */}
      <div className="sandbox-sidebar-section">
        <div className="sandbox-sidebar-label">节点面板</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {NODE_PALETTE.map(n => (
            <button
              key={n.type}
              className="sandbox-node-btn"
              draggable
              onDragStart={e => handleDragStart(e, n.type as SandboxNodeType)}
              title={n.label}
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              <span>{n.icon}</span> {n.label}
            </button>
          ))}
          {customPalette && customPalette.length > 0 && (
            <>
              <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
              {customPalette.map(n => (
                <button
                  key={n.type}
                  className="sandbox-node-btn"
                  draggable
                  onDragStart={e => handleDragStart(e, n.type as SandboxNodeType)}
                  title={n.label}
                  style={{ fontSize: '11px', padding: '4px 8px', borderColor: n.color }}
                >
                  <span>{n.icon}</span> {n.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Agents */}
      <div className="sandbox-sidebar-section" style={{ flex: '0 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="sandbox-sidebar-label">可用 Agent（点击加入沙盒）</div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {agents.length === 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-2)' }}>
              暂无 Agent
            </div>
          )}
          {agents.map(a => {
            const isActive = activeAgentIds.includes(a.id);
            return (
              <div key={a.id} className={`sandbox-locked-agent${isActive ? '' : ''}`}
                style={{ opacity: isActive ? 1 : 0.5 }}>
                <span style={{ flex: 1, fontSize: 'var(--text-sm)' }}>{a.name}</span>
                <button
                  className="sandbox-toggle"
                  onClick={() => onToggleAgent(a.id)}
                  style={{
                    background: isActive ? 'var(--color-sandbox-orange)' : 'var(--color-bg)',
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text)',
                    border: `1px solid ${isActive ? 'var(--color-sandbox-orange)' : 'var(--border-color)'}`,
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {isActive ? '移出' : '加入'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
