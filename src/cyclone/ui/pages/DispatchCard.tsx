import { useState } from 'react';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';

const STATUS_LABEL: Record<CycloneDispatch['status'], string> = {
  queued: '等待工位',
  running: '工位执行中',
  awaiting_human: '等待你的回答',
  completed: '已完成',
  failed: '执行失败',
};

function activityLabel(item: CycloneDispatch): string | null {
  const activity = item.activity;
  if (!activity) return null;
  if (activity.phase === 'waiting-agent') return '等待同一 Agent 的当前任务结束';
  if (activity.phase === 'llm-waiting') return '等待模型响应';
  if (activity.phase === 'model-output') return '模型正在生成';
  if (activity.phase === 'tool-preparing') return activity.tool
    ? `正在准备 ${activity.tool} 参数`
    : '正在准备工具参数';
  return activity.tool ? `正在执行 ${activity.tool}` : '正在执行工具';
}

export default function DispatchCard({ item, highlighted, onAction, onOpenSeat }: {
  item: CycloneDispatch;
  highlighted?: boolean;
  onAction: (action: DispatchAction) => Promise<void>;
  onOpenSeat: () => void;
}) {
  const [busy, setBusy] = useState<DispatchAction | null>(null);
  const [expanded, setExpanded] = useState(false);
  const folded = item.decisionState !== 'pending';

  async function act(action: DispatchAction) {
    if (busy) return;
    setBusy(action);
    try { await onAction(action); } finally { setBusy(null); }
  }

  if (folded) {
    const decision = item.decisionState === 'included' ? '已带入讨论'
      : item.decisionState === 'dismissed' ? '未带入' : '已过期';
    return (
      <article id={`dispatch-${item.id}`} className="cyclone-dispatch cyclone-dispatch--folded">
        <button type="button" className="cyclone-dispatch__fold-trigger"
          aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="cyclone-dispatch__arrow">{expanded ? '▼' : '▶'}</span>
          <span>{item.targetSeatTitle} · {decision}</span>
        </button>
        {expanded && (
          <div className="cyclone-dispatch__fold-body">
            <div className="cyclone-dispatch__task">{item.task}</div>
            {item.response && <div className="cyclone-dispatch__result">{item.response}</div>}
            {item.error && <div className="cyclone-dispatch__error">{item.error}</div>}
          </div>
        )}
      </article>
    );
  }

  const active = item.status === 'queued' || item.status === 'running';
  const activity = activityLabel(item);
  return (
    <article
      id={`dispatch-${item.id}`}
      className={`cyclone-dispatch${highlighted ? ' cyclone-dispatch--highlighted' : ''}`}
      onClick={() => { if (item.readState === 'unread') void act('read'); }}
    >
      <header className="cyclone-dispatch__header">
        <span className={`cyclone-dispatch__dot${active ? ' cyclone-dispatch__dot--active' : ''}`} />
        <strong>{STATUS_LABEL[item.status]}</strong>
        <span className="cyclone-dispatch__target">→ {item.targetSeatTitle}</span>
      </header>
      <div className="cyclone-dispatch__task">{item.task}</div>
      {active && activity && (
        <div className="cyclone-dispatch__activity" role="status">
          <span className="cyclone-dispatch__dot cyclone-dispatch__dot--active" />
          <span>{activity}</span>
          {item.activity?.target && <code title={item.activity.target}>{item.activity.target}</code>}
        </div>
      )}
      {item.status === 'completed' && item.response && (
        <div className="cyclone-dispatch__result">{item.response}</div>
      )}
      {item.status === 'failed' && (
        <div className="cyclone-dispatch__error">{item.error || '派发执行失败'}</div>
      )}
      <footer className="cyclone-dispatch__actions">
        <button type="button" onClick={event => { event.stopPropagation(); onOpenSeat(); }}>查看工位</button>
        {item.status === 'completed' && (
          <button type="button" disabled={!!busy} className="cyclone-dispatch__primary"
            onClick={event => { event.stopPropagation(); void act('include'); }}>
            {busy === 'include' ? '带入中…' : '带入讨论'}
          </button>
        )}
        {(item.status === 'completed' || item.status === 'failed') && (
          <button type="button" disabled={!!busy}
            onClick={event => { event.stopPropagation(); void act('dismiss'); }}>
            不带入
          </button>
        )}
      </footer>
    </article>
  );
}
