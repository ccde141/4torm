import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import { useConsoleText } from './console-text';

export type ConsoleStatusValue = WorkspaceEntityStatus | 'completed' | 'aborted';

export function ConsoleStatus({ status }: { status: ConsoleStatusValue }) {
  const text = useConsoleText();
  const labels: Record<ConsoleStatusValue, string> = {
    idle: text('空闲', 'Idle'), running: text('执行中', 'Running'), waiting: text('等待你', 'Waiting'),
    unknown: text('状态未知', 'Unknown'), failed: text('执行失败', 'Failed'),
    unread: text('有新结果', 'New result'), completed: text('已完成', 'Completed'), aborted: text('已停止', 'Stopped'),
  };
  return <span className={`cy-console-badge ${status}`}><i className="cy-console-dot" />{labels[status]}</span>;
}
