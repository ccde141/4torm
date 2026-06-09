/**
 * Human Gate 节点 — 信封审查台（金黄色菱形）
 *
 * 视觉规则（设计文档）：
 * - 金黄色菱形：与其他节点完全区分
 * - waiting 时红光闪烁：上游信封到达，等待人类决策
 * - 工作流未启动：菱形保持静态
 */
import { useEffect, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function HumanGateNode({ id, data, selected }: NodeProps) {
  const label = (data as any)?.label ?? '人类审查';
  const memo = (data as any)?.memo ?? '';
  const running = !!(window as any).__tw_running;

  const [status, setStatus] = useState<{
    busy: boolean;
    envelopePending: boolean;
    humanGate?: { waiting: true; envelopeContent: string; arrivedAt: number };
  }>({ busy: false, envelopePending: false });

  useEffect(() => {
    const update = () => {
      const all = (window as any).__tw_node_status || {};
      setStatus(all[id] || { busy: false, envelopePending: false });
    };
    update();
    window.addEventListener('tw-node-status', update);
    return () => window.removeEventListener('tw-node-status', update);
  }, [id]);

  const openPanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running || !status.humanGate?.waiting) return;
    window.dispatchEvent(new CustomEvent('tw-open-gate', {
      detail: { nodeId: id, label, envelopeContent: status.humanGate.envelopeContent },
    }));
  };

  const waiting = !!status.humanGate?.waiting;
  const cls = [
    'tw-node', 'tw-node--gate',
    selected ? 'tw-node--selected' : '',
    waiting ? 'tw-node--gate-waiting' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onClick={openPanel}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__gate-inner">
        <div className="tw-node__icon">◇</div>
        <div className="tw-node__label">{label}</div>
        {waiting && <div className="tw-node__sub">等待审查...</div>}
      </div>
      {memo && <div className="tw-node__memo">{memo}</div>}
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
