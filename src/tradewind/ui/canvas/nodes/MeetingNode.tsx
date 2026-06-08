/**
 * Meeting 节点 — 圆桌会议（紫色主色调）
 */
import { useEffect, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function MeetingNode({ id, data, selected }: NodeProps) {
  const config = (data as any)?.config ?? {};
  const label = (data as any)?.label ?? '会议室';
  const memo = (data as any)?.memo ?? '';
  const count = config.participantNodeIds?.length ?? 0;
  const running = !!(window as any).__tw_running;

  const [status, setStatus] = useState<{ busy: boolean; envelopePending: boolean }>({ busy: false, envelopePending: false });
  useEffect(() => {
    const update = () => {
      const all = (window as any).__tw_node_status || {};
      const my = all[id] || { busy: false, envelopePending: false };
      setStatus(my);
    };
    update();
    window.addEventListener('tw-node-status', update);
    return () => window.removeEventListener('tw-node-status', update);
  }, [id]);

  const openMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running) return;
    window.dispatchEvent(new CustomEvent('tw-open-meeting', { detail: { nodeId: id, label } }));
  };

  const cls = [
    'tw-node', 'tw-node--meeting',
    selected ? 'tw-node--selected' : '',
    status.busy ? 'tw-node--busy' : '',
    status.envelopePending ? 'tw-node--envelope' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__icon">◎</div>
      <div className="tw-node__label">{label}</div>
      {count > 0 && <div className="tw-node__sub">{count} 参与者</div>}
      {memo && <div className="tw-node__memo">{memo}</div>}
      <button
        className={`tw-node__chat-btn ${running ? 'tw-node__chat-btn--active' : 'tw-node__chat-btn--idle'}`}
        onClick={openMeeting}
        title={running ? '进入会议' : '需要先启动工作流'}
      >
        {running ? '🎙 会议' : '未运行'}
      </button>
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
