/**
 * 信风自定义边
 *
 * 视觉规则：
 * - handoff（实线白）：默认普通信封传递
 * - note（虚线黄）：行为约束注入
 * - rework（实线红）：Human Gate 打回路径
 */
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export function TradeWindEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const d = (data ?? {}) as { kind?: string; rework?: boolean };
  const kind = d.kind ?? 'handoff';
  const isRework = !!d.rework;

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 12,
  });

  const isNote = kind === 'note';

  let stroke: string;
  let strokeWidth = 2;
  let dash: string | undefined;
  let opacity = 0.7;

  if (isRework) {
    stroke = '#ef4444'; // 红色：打回边
    strokeWidth = 2.2;
    opacity = 0.9;
  } else if (isNote) {
    stroke = 'var(--color-accent-secondary)';
    strokeWidth = 1.5;
    dash = '6 4';
  } else {
    stroke = 'var(--color-accent)';
  }

  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke, strokeWidth, strokeDasharray: dash, opacity }}
    />
  );
}
