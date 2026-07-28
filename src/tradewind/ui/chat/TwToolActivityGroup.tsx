import type { ReactNode } from 'react';

type Activity = {
  tool?: string;
  status?: string;
};

export default function TwToolActivityGroup<T extends Activity>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  if (items.length < 2) return <>{items.map(renderItem)}</>;

  const running = items.some(item => item.status === 'running' || item.status === 'pending');
  const failed = items.some(item => item.status === 'error');
  const state = running ? '执行中' : failed ? '部分失败' : '已完成';

  return (
    <details className="tw-tool-activity" open={running}>
      <summary className="tw-tool-activity__summary">
        <span className="tw-tool-activity__arrow">›</span>
        <span>{items.length} 次工具活动</span>
        <span className="tw-tool-activity__state">{state}</span>
      </summary>
      <div className="tw-tool-activity__body">{items.map(renderItem)}</div>
    </details>
  );
}
