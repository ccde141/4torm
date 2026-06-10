/**
 * 右侧配置面板 — 选中节点后滑出，编辑节点配置
 *
 * Schema 驱动：根据节点类型渲染不同的表单字段。
 * 动画：右侧滑入 + 毛玻璃背景。
 */

import { useState, useEffect } from 'react';
import type { Node } from '@xyflow/react';

interface AgentSummary {
  id: string;
  name: string;
  model: string;
}

interface ConfigPanelProps {
  node: Node | null;
  nodes: Node[];
  edges: import('@xyflow/react').Edge[];
  onClose: () => void;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onSyncReworkEdge: (gateNodeId: string, targetNodeId: string | null) => void;
}

export function ConfigPanel({ node, nodes, edges, onClose, onUpdate, onSyncReworkEdge }: ConfigPanelProps) {
  if (!node) return null;

  const nodeType = node.type ?? 'unknown';
  const data = (node.data ?? {}) as Record<string, unknown>;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const label = (data.label ?? node.id) as string;

  return (
    <div className="tw-config">
      <div className="tw-config__header">
        <span className="tw-config__type">{getTypeLabel(nodeType)}</span>
        <span className="tw-config__title">{label}</span>
        <button className="tw-config__close" onClick={onClose}>×</button>
      </div>
      <div className="tw-config__body">
        <LabelField nodeId={node.id} label={label} onUpdate={onUpdate} config={config} />
        <MemoField nodeId={node.id} memo={(data.memo as string) ?? ''} onUpdate={onUpdate} config={config} label={label} />
        <ConfigFields
          nodeId={node.id}
          nodeType={nodeType}
          config={config}
          label={label}
          onUpdate={onUpdate}
          nodes={nodes}
          edges={edges}
          currentNodeId={node.id}
          onSyncReworkEdge={onSyncReworkEdge}
        />
      </div>
    </div>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────

interface FieldProps {
  nodeId: string;
  label: string;
  config: Record<string, unknown>;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
}

function LabelField({ nodeId, label, onUpdate, config }: FieldProps) {
  const [val, setVal] = useState(label);
  useEffect(() => setVal(label), [label]);

  const commit = () => {
    if (val !== label) onUpdate(nodeId, { label: val, config });
  };

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">显示名</label>
      <input
        className="tw-config__input"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </div>
  );
}

function MemoField({ nodeId, memo, onUpdate, config, label }: { nodeId: string; memo: string; onUpdate: (id: string, data: Record<string, unknown>) => void; config: Record<string, unknown>; label: string }) {
  const [val, setVal] = useState(memo);
  useEffect(() => setVal(memo), [memo]);
  const commit = () => {
    if (val !== memo) onUpdate(nodeId, { label, config, memo: val });
  };
  return (
    <div className="tw-config__field">
      <label className="tw-config__label">备注</label>
      <textarea
        className="tw-config__textarea"
        rows={2}
        placeholder="仅人类可见的备注（不影响 Agent 行为）"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

interface ConfigFieldsProps extends FieldProps {
  nodeType: string;
  nodes: Node[];
  edges: import('@xyflow/react').Edge[];
  currentNodeId: string;
  onSyncReworkEdge: (gateNodeId: string, targetNodeId: string | null) => void;
}

function ConfigFields({ nodeId, nodeType, config, label, onUpdate, nodes, edges, currentNodeId, onSyncReworkEdge }: ConfigFieldsProps) {
  const update = (key: string, value: unknown) => {
    onUpdate(nodeId, { label, config: { ...config, [key]: value } });
  };

  switch (nodeType) {
    case 'agent':
      return <AgentFields config={config} onChange={update} />;
    case 'meeting':
      return <MeetingFields config={config} onChange={update} nodes={nodes} currentNodeId={currentNodeId} />;
    case 'note':
      return <NoteFields config={config} onChange={update} />;
    case 'human-gate':
      return <HumanGateFields />;
    case 'output':
      return <OutputFields config={config} onChange={update} />;
    case 'entry':
      return <EntryFields config={config} onChange={update} />;
    default:
      return <div className="tw-config__hint">无可配置项</div>;
  }
}

// ── Agent 配置 ────────────────────────────────────────────────────

function AgentFields({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const agentId = (config.agentId as string) ?? '';

  useEffect(() => {
    fetch('/api/tradewind/agents')
      .then(r => r.json())
      .then((d: { agents: AgentSummary[] }) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">Agent</label>
      <select
        className="tw-config__select"
        value={agentId}
        onChange={(e) => onChange('agentId', e.target.value)}
      >
        <option value="">-- 选择 Agent --</option>
        {agents.map(a => (
          <option key={a.id} value={a.id}>{a.name} ({a.id.slice(0, 12)})</option>
        ))}
      </select>
    </div>
  );
}

// ── Meeting 配置 ──────────────────────────────────────────────────

interface MeetingFieldsProps {
  config: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  nodes: Node[];
  currentNodeId: string;
}

function MeetingFields({ config, onChange, nodes, currentNodeId }: MeetingFieldsProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const chairAgentId = (config.chairAgentId as string) ?? '';
  const participantNodeIds = (config.participantNodeIds as string[]) ?? [];

  // 获取全局 Agent 池（会长选择用）
  useEffect(() => {
    fetch('/api/tradewind/agents')
      .then(r => r.json())
      .then((d: { agents: AgentSummary[] }) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  // 画布上的 Agent 节点（排除自身）
  const agentNodes = nodes.filter(
    n => n.type === 'agent' && n.id !== currentNodeId
  );

  const toggleParticipant = (nodeId: string) => {
    const next = participantNodeIds.includes(nodeId)
      ? participantNodeIds.filter(id => id !== nodeId)
      : [...participantNodeIds, nodeId];
    onChange('participantNodeIds', next);
  };

  return (
    <>
      <div className="tw-config__field">
        <label className="tw-config__label">会长</label>
        <select
          className="tw-config__select"
          value={chairAgentId}
          onChange={(e) => onChange('chairAgentId', e.target.value)}
        >
          <option value="">-- 选择会长 --</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="tw-config__field">
        <label className="tw-config__label">参与者（画布 Agent 节点）</label>
        {agentNodes.length === 0 ? (
          <div className="tw-config__hint">画布上无 Agent 节点</div>
        ) : (
          <div className="tw-config__checklist">
            {agentNodes.map(n => {
              const nd = (n.data ?? {}) as Record<string, unknown>;
              const nodeLabel = (nd.label as string) || n.id;
              const checked = participantNodeIds.includes(n.id);
              return (
                <label key={n.id} className="tw-config__check-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleParticipant(n.id)}
                  />
                  <span>{nodeLabel}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── Note 配置 ─────────────────────────────────────────────────────

function NoteFields({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const [content, setContent] = useState((config.content as string) ?? '');
  useEffect(() => setContent((config.content as string) ?? ''), [config.content]);

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">约束内容</label>
      <textarea
        className="tw-config__textarea"
        rows={5}
        placeholder="输入行为约束文本..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => onChange('content', content)}
      />
    </div>
  );
}

// ── Human Gate 配置（暂停点无需额外配置） ─────────────────────────

function HumanGateFields() {
  return (
    <div className="tw-config__field">
      <div className="tw-config__hint">
        暂停点无需配置。信封到达后流程暂停，人类可编辑内容后继续。
      </div>
    </div>
  );
}

// ── Entry 配置 ────────────────────────────────────────────────────

function EntryFields({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const [envelope, setEnvelope] = useState((config.initialEnvelope as string) ?? '');
  useEffect(() => setEnvelope((config.initialEnvelope as string) ?? ''), [config.initialEnvelope]);

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">初始信封</label>
      <textarea
        className="tw-config__textarea"
        rows={5}
        placeholder="启动工作流时自动注入的内容（留空则启动时手动输入）"
        value={envelope}
        onChange={(e) => setEnvelope(e.target.value)}
        onBlur={() => onChange('initialEnvelope', envelope)}
      />
      <div className="tw-config__hint">
        工作流启动时，此内容作为初始信封自动传递给下游节点
      </div>
    </div>
  );
}

// ── Output 配置 ───────────────────────────────────────────────────

function OutputFields({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const [name, setName] = useState((config.archiveName as string) ?? '');
  useEffect(() => setName((config.archiveName as string) ?? ''), [config.archiveName]);

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">归档名称</label>
      <input
        className="tw-config__input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onChange('archiveName', name)}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange('archiveName', name); }}
        placeholder="留空则使用时间戳"
      />
      <div className="tw-config__hint">
        工作流完成时，自动归档全部节点对话历史到 workspace/transcripts/ 目录
      </div>
    </div>
  );
}

// ── 辅助 ──────────────────────────────────────────────────────────

function getTypeLabel(type: string): string {
  const map: Record<string, string> = {
    entry: '入口', output: '出口', agent: 'Agent',
    meeting: '会议室', note: 'Note', 'human-gate': '暂停点',
  };
  return map[type] ?? type;
}
