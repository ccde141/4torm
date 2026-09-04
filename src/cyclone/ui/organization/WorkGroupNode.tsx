import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';

export interface WorkGroupNodeData extends Record<string, unknown> {
  title: string;
  memberCount: number;
  seatCountLabel: string;
  onResize(width: number, height: number): void;
}

export function WorkGroupNode({ data, selected }: NodeProps<Node<WorkGroupNodeData>>) {
  return (
    <section className={`cyclone-org-group${selected ? ' cyclone-org-group--selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={260} minHeight={180}
        onResizeEnd={(_, size) => data.onResize(size.width, size.height)} />
      <header>{data.title}</header>
      <div className="cyclone-org-group__marker" aria-hidden="true" />
      <span>{data.seatCountLabel}</span>
    </section>
  );
}
