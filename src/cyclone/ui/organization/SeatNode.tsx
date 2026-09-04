import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import AgentAvatar from '../../../components/agents/AgentAvatar';
import type { Agent } from '../../../types';

export interface SeatNodeData extends Record<string, unknown> {
  title: string;
  duty?: string;
  agent?: Agent;
  status: WorkspaceEntityStatus;
  completedSignal: number;
  labels: Record<WorkspaceEntityStatus, string> & { seat: string; openChat: string };
  onOpen(): void;
}

export function SeatNode({ data, selected }: NodeProps<Node<SeatNodeData>>) {
  const [justDone, setJustDone] = useState(false);
  const previousSignal = useRef(data.completedSignal);
  useEffect(() => {
    if (data.completedSignal > previousSignal.current) setJustDone(true);
    previousSignal.current = data.completedSignal;
  }, [data.completedSignal]);
  const className = [
    'cyclone-org-seat', selected ? 'cyclone-org-seat--selected' : '',
    data.status === 'running' ? 'cyclone-org-seat--busy' : '', `cyclone-org-seat--${data.status}`,
    justDone ? 'cyclone-org-seat--done' : '',
  ].filter(Boolean).join(' ');
  return (
    <article className={className} aria-label={`${data.labels.seat}：${data.title}`}
      onDoubleClick={data.onOpen}
      onAnimationEnd={event => {
        if (event.animationName === 'cyclone-seat-done-pop') setJustDone(false);
      }}>
      <Handle id="top" type="source" position={Position.Top} className="cyclone-org-handle" />
      <Handle id="left" type="source" position={Position.Left} className="cyclone-org-handle" />
      <div className="cyclone-org-seat__identity">
        <AgentAvatar agent={data.agent} className="cyclone-org-seat__avatar" fallback={data.title.slice(0, 2)} />
        <div><strong>{data.title}</strong>{data.duty && <p>{data.duty}</p>}</div>
      </div>
      <span className={`cyclone-org-seat__status cyclone-org-seat__status--${data.status}`}>
        <i aria-hidden="true" />{data.labels[data.status]}
      </span>
      <button type="button" onClick={event => { event.stopPropagation(); data.onOpen(); }}>
        {data.labels.openChat}
      </button>
      <Handle id="right" type="source" position={Position.Right} className="cyclone-org-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="cyclone-org-handle" />
    </article>
  );
}
