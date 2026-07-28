/**
 * Human Gate 节点 — 暂停点（金黄色主色调）
 *
 * 与 AgentNode 同构的矩形布局，不用异形。
 * waiting 状态时节点闪烁 + 按钮可点击打开编辑面板。
 */
import { useEffect, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function HumanGateNode({ id, data, selected }: NodeProps) {
  const label = (data as any)?.label ?? '暂停点';
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
    status.envelopePending ? 'tw-node--envelope' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__icon">◇</div>
      <div className="tw-node__label">{label}</div>
      <div className={`tw-node__state-line ${waiting ? 'tw-node__state-line--waiting' : ''}`}>
        <span className="tw-node__state-dot" />
        <span>{waiting ? '等待人工确认' : running ? '等待信封' : '尚未运行'}</span>
      </div>
      {memo && <div className="tw-node__memo">{memo}</div>}
      {waiting && (
        <button className="tw-node__gate-action" onClick={openPanel} title="查看信封内容并决定是否修改">
          审查并继续
        </button>
      )}
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
