import type { WorkflowRunSummary } from './records-client';

export function recordWords(english: boolean) {
  return english ? {
    title: 'Workflow run records', refresh: 'Refresh', loading: 'Loading records…',
    noRuns: 'No saved execution records yet.', choose: 'Select an execution to view its events.',
    events: 'Recorded events', noEvents: 'No events in this page.', run: 'Execution',
    started: 'Started', ended: 'Ended', open: 'Open run graph', opening: 'Opening…',
    before: 'Previous', after: 'Next', eventType: 'Event type', all: 'All event types',
    since: 'From', until: 'To', filter: 'Apply', invalidTime: 'The end must follow the start.',
    payload: 'Event details', noPayload: 'No additional event details.',
    fragment: 'Content segment', moreScan: 'More events remain; continue to the next page.',
    partial: 'The latest event is still being saved. Refresh to read it.',
    fact: 'Times and events come from saved execution records.',
  } : {
    title: '本工作流运行记录', refresh: '刷新', loading: '正在读取记录…',
    noRuns: '还没有已保存的运行记录。', choose: '选择一次运行，查看它的事件记录。',
    events: '已记录的事件', noEvents: '本页没有符合条件的事件。', run: '执行',
    started: '开始', ended: '结束', open: '打开运行图', opening: '正在打开…',
    before: '上一页', after: '下一页', eventType: '事件类型', all: '全部事件',
    since: '起始时间', until: '结束时间', filter: '筛选', invalidTime: '结束时间应晚于起始时间。',
    payload: '事件详情', noPayload: '这条事件没有额外正文。',
    fragment: '正文分段', moreScan: '还有事件未扫描，可继续查看下一页。',
    partial: '最新事件尚在保存，刷新后可继续查看。',
    fact: '按次查看交付结果、节点上下文与信封交接。',
  };
}

export function statusLabel(status: WorkflowRunSummary['status'], english: boolean) {
  const labels = { running: ['运行中', 'Running'], completed: ['已完成', 'Completed'],
    failed: ['失败', 'Failed'], aborted: ['已停止', 'Stopped'], crashed: ['异常中断', 'Interrupted'] };
  return labels[status][english ? 1 : 0];
}

export function eventLabel(type: string, english: boolean) {
  const labels: Record<string, string[]> = {
    'node-activate': ['节点激活', 'Node activated'], 'work-done': ['工作完成', 'Work completed'],
    handoff: ['信封交接', 'Handoff'], 'sub-agent-start': ['协作开始', 'Collaboration started'],
    'sub-agent-done': ['协作完成', 'Collaboration completed'], 'node-error': ['执行错误', 'Execution error'],
    'meeting-start': ['会议开始', 'Meeting started'], 'meeting-speak': ['会议发言', 'Meeting response'],
    'meeting-end': ['会议结束', 'Meeting ended'], 'human-gate-arrive': ['等待人类', 'Waiting for human'],
    'workflow-end': ['工作流结束', 'Workflow ended'], 'auto-anomaly': ['异常交接', 'Abnormal handoff'],
    'delivery-delay': ['等待投递', 'Delivery delay'], 'lap-done': ['本轮完成', 'Lap completed'],
    'loop-end': ['循环结束', 'Loop ended'],
    'activation-started': ['开始处理信封', 'Envelope processing started'],
    'activation-finished': ['本次处理结束', 'Activation finished'],
    'handoff-sent': ['发送交接', 'Handoff sent'],
    'handoff-received': ['收到信封', 'Envelope received'],
    'envelope-completed': ['信封已交付', 'Envelope delivered'],
    'agent-round-started': ['Agent 开始回复', 'Agent response started'],
    'agent-round-finished': ['Agent 回复结束', 'Agent response finished'],
  };
  return labels[type]?.[english ? 1 : 0] ?? type;
}

export const EVENT_TYPES = ['activation-started', 'activation-finished', 'handoff-sent', 'handoff-received',
  'envelope-completed', 'agent-round-started', 'agent-round-finished', 'node-activate', 'handoff', 'work-done', 'node-error',
  'human-gate-arrive', 'workflow-end', 'sub-agent-start', 'sub-agent-done',
  'meeting-start', 'meeting-speak', 'meeting-end', 'delivery-delay', 'auto-anomaly', 'lap-done', 'loop-end'];

export function previewLabel(preview: string, route?: { source?: string; target?: string }): string {
  if (typeof route?.source === 'string' && typeof route.target === 'string') return `${route.source} → ${route.target}`;
  if (!preview.startsWith('{') && !preview.startsWith('[')) return preview;
  try {
    const value: unknown = JSON.parse(preview);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.source === 'string' && typeof record.target === 'string') return `${record.source} → ${record.target}`;
  } catch { /* Partial previews remain available through the full event details. */ }
  return '';
}
