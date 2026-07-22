/**
 * Agent 节点 — 工作节点（琥珀色主色调）
 */
import { useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { subscribe, unsubscribe } from '../../stream/unified-client';
import { feedbackFromNodeEvent, type NodeTerminalOutcome } from '../node-feedback';

export function AgentNode({ id, data, selected }: NodeProps) {
  const config = (data as any)?.config ?? {};
  const label = (data as any)?.label ?? 'Agent';
  const memo = (data as any)?.memo ?? '';
  const running = !!(window as any).__tw_running;

  // 订阅节点状态：busy（蓝色闪）/ envelopePending（琥珀光环）
  const [status, setStatus] = useState<{ busy: boolean; envelopePending: boolean }>({ busy: false, envelopePending: false });
  // 正常完成由明确的 SSE 终态触发绿色反馈；停止和错误保留红色终态。
  const [justDone, setJustDone] = useState(false);
  const [terminal, setTerminal] = useState<Exclude<NodeTerminalOutcome, 'completed'> | null>(null);
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const update = () => {
      const all = (window as any).__tw_node_status || {};
      const my = all[id] || { busy: false, envelopePending: false };
      if (my.busy && !prevBusyRef.current) {
        setJustDone(false);
        setTerminal(null);
      }
      prevBusyRef.current = my.busy;
      setStatus(my);
    };
    update();
    window.addEventListener('tw-node-status', update);
    return () => window.removeEventListener('tw-node-status', update);
  }, [id]);

  useEffect(() => {
    const handleEvent = (event: { nodeId?: string; type?: string; outcome?: NodeTerminalOutcome }) => {
      const feedback = feedbackFromNodeEvent(event, id);
      if (feedback === 'completed') setJustDone(true);
      if (feedback === 'stopped' || feedback === 'error') {
        setJustDone(false);
        setTerminal(feedback);
      }
    };
    subscribe(id, handleEvent);
    return () => unsubscribe(id, handleEvent);
  }, [id]);

  const openChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running) return;
    window.dispatchEvent(new CustomEvent('tw-open-chat', { detail: { nodeId: id, label } }));
  };

  const cls = [
    'tw-node', 'tw-node--agent',
    selected ? 'tw-node--selected' : '',
    status.busy ? 'tw-node--busy' : '',
    status.envelopePending ? 'tw-node--envelope' : '',
    justDone ? 'tw-node--just-done' : '',
    terminal === 'stopped' ? 'tw-node--stopped' : '',
    terminal === 'error' ? 'tw-node--failed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onAnimationEnd={(e) => { if (e.animationName === 'tw-node-done-pop') setJustDone(false); }}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__icon">⚡</div>
      <div className="tw-node__label">{label}</div>
      {config.agentId && (
        <div className="tw-node__sub">{config.agentId.slice(0, 12)}</div>
      )}
      {memo && <div className="tw-node__memo">{memo}</div>}
      <button
        className={`tw-node__chat-btn ${running ? 'tw-node__chat-btn--active' : 'tw-node__chat-btn--idle'}`}
        onClick={openChat}
        title={running ? '打开对话' : '需要先启动工作流'}
      >
        {running ? '💬 交流' : '未运行'}
      </button>
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
