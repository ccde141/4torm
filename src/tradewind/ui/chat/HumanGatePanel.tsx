/**
 * Human Gate 审查弹窗
 *
 * 触发：监听 tw-open-gate CustomEvent
 * 行为：展示信封内容 → 人类批准/打回 → POST /human-gate/{id}/submit
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface HumanGatePanelProps {
  nodeId: string;
  nodeLabel: string;
  envelopeContent: string;
  onClose: () => void;
}

export function HumanGatePanel({ nodeId, nodeLabel, envelopeContent, onClose }: HumanGatePanelProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (action: 'approve' | 'rework') => {
    if (busy) return;
    if (action === 'rework' && !comment.trim()) {
      setError('打回必须填写反馈意见');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tradewind/human-gate/${nodeId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action } : { action, comment: comment.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="tw-gate-overlay">
      <div className="tw-gate-panel">
        <div className="tw-gate-panel__header">
          <span className="tw-gate-panel__title">人类审查 · {nodeLabel}</span>
          <button className="tw-gate-panel__close" onClick={onClose}>×</button>
        </div>
        <div className="tw-gate-panel__body">
          <div className="tw-gate-panel__section-title">上游信封内容</div>
          <pre className="tw-gate-panel__envelope">{envelopeContent}</pre>

          <div className="tw-gate-panel__section-title">打回反馈（仅打回时必填）</div>
          <textarea
            className="tw-gate-panel__comment"
            placeholder="如需打回，写明问题所在，反馈会送回上游让其重做..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={busy}
            rows={5}
          />

          {error && <div className="tw-gate-panel__error">{error}</div>}
        </div>
        <div className="tw-gate-panel__actions">
          <button
            className="tw-gate-panel__btn tw-gate-panel__btn--rework"
            onClick={() => submit('rework')}
            disabled={busy || !comment.trim()}
          >
            打回（沿红色 rework 边送回反馈）
          </button>
          <button
            className="tw-gate-panel__btn tw-gate-panel__btn--approve"
            onClick={() => submit('approve')}
            disabled={busy}
          >
            批准（信封原样放行）
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
