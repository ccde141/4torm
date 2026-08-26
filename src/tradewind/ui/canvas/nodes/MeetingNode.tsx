/**
 * Meeting 节点 — 圆桌会议（紫色主色调）
 */
import { useEffect, useState } from 'react';
import { Handle, Position, NodeResizer, useNodes, type NodeProps } from '@xyflow/react';
import { useLocale } from '../../../../i18n/LocaleContext';

export function MeetingNode({ id, data, selected }: NodeProps) {
  const { t } = useLocale();
  const config = (data as any)?.config ?? {};
  const label = (data as any)?.label ?? t('tradewind.canvas.node.meeting');
  const memo = (data as any)?.memo ?? '';
  const running = !!(window as any).__tw_running;

  // 过滤掉画布上已不存在的 nodeId，避免计数偏差
  const allNodes = useNodes();
  const existingNodeIds = new Set(allNodes.map(n => n.id));
  const participantIds: string[] = config.participantNodeIds ?? [];
  const count = participantIds.filter(pid => existingNodeIds.has(pid)).length;

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
      {count > 0 && <div className="tw-node__sub">{t('tradewind.canvas.meeting.participants', { count })}</div>}
      {memo && <div className="tw-node__memo">{memo}</div>}
      <button
        className={`tw-node__chat-btn ${running ? 'tw-node__chat-btn--active' : 'tw-node__chat-btn--idle'}`}
        onClick={openMeeting}
        title={running ? t('tradewind.canvas.meeting.enter') : t('tradewind.canvas.agent.startFirst')}
      >
        {running ? t('tradewind.canvas.meeting.open') : t('tradewind.canvas.node.notRunning')}
      </button>
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
