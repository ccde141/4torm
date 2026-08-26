/**
 * 右侧配置面板 — 选中节点后滑出，编辑节点配置
 *
 * Schema 驱动：根据节点类型渲染不同的表单字段。
 * 动画：右侧滑入 + 毛玻璃背景。
 */

import { useState, useEffect } from 'react';
import type { Node } from '@xyflow/react';
import { ConfigFields } from './ConfigFields';
import { useLocale } from '../../../i18n/LocaleContext';

interface ConfigPanelProps {
  node: Node | null;
  nodes: Node[];
  edges: import('@xyflow/react').Edge[];
  onClose: () => void;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onSyncReworkEdge: (gateNodeId: string, targetNodeId: string | null) => void;
}

export function ConfigPanel({ node, nodes, edges, onClose, onUpdate, onSyncReworkEdge }: ConfigPanelProps) {
  const { t } = useLocale();
  if (!node) return null;

  const nodeType = node.type ?? 'unknown';
  const data = (node.data ?? {}) as Record<string, unknown>;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const label = (data.label ?? node.id) as string;

  return (
    <div className="tw-config mo-slide-in-right">
      <div className="tw-config__header">
        <span className="tw-config__type">{getTypeLabel(nodeType, t)}</span>
        <span className="tw-config__title">{label}</span>
        <button className="tw-config__close" onClick={onClose} aria-label={t('tradewind.config.close')}>×</button>
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
  const { t } = useLocale();
  const [val, setVal] = useState(label);
  useEffect(() => setVal(label), [label]);

  const commit = () => {
    if (val !== label) onUpdate(nodeId, { label: val, config });
  };

  return (
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.displayName')}</label>
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
  const { t } = useLocale();
  const [val, setVal] = useState(memo);
  useEffect(() => setVal(memo), [memo]);
  const commit = () => {
    if (val !== memo) onUpdate(nodeId, { label, config, memo: val });
  };
  return (
    <div className="tw-config__field">
      <label className="tw-config__label">{t('tradewind.config.memo')}</label>
      <textarea
        className="tw-config__textarea"
        rows={2}
        placeholder={t('tradewind.config.memoPlaceholder')}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

// ── 辅助 ──────────────────────────────────────────────────────────

function getTypeLabel(type: string, t: ReturnType<typeof useLocale>['t']): string {
  const map: Record<string, string> = {
    entry: t('tradewind.config.type.entry'), output: t('tradewind.config.type.output'), agent: 'Agent',
    meeting: t('tradewind.config.type.meeting'), note: 'Note', 'human-gate': t('tradewind.config.type.humanGate'),
  };
  return map[type] ?? type;
}
