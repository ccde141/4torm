/**
 * Human Gate 暂停点面板
 *
 * 触发：监听 tw-open-gate CustomEvent
 * 行为：展示可编辑的信封内容 → 人类编辑后点"继续" → POST /human-gate/{id}/submit
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
  const [content, setContent] = useState(envelopeContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tradewind/human-gate/${nodeId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() || envelopeContent }),
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

  const isModified = content.trim() !== envelopeContent.trim();

  return createPortal(
    <div className="tw-gate-overlay">
      <div className="tw-gate-panel">
        <div className="tw-gate-panel__header">
          <span className="tw-gate-panel__title">暂停点 · {nodeLabel}</span>
          <button className="tw-gate-panel__close" onClick={onClose}>×</button>
        </div>
        <div className="tw-gate-panel__body">
          <div className="tw-gate-panel__section-title">
            信封内容 {isModified && <span style={{ color: '#f59e0b', fontSize: '0.8em' }}>（已修改）</span>}
          </div>
          <textarea
            className="tw-gate-panel__editor"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            rows={16}
          />
          {error && <div className="tw-gate-panel__error">{error}</div>}
        </div>
        <div className="tw-gate-panel__actions">
          <button
            className="tw-gate-panel__btn tw-gate-panel__btn--continue"
            onClick={submit}
            disabled={busy}
          >
            {isModified ? '提交修改并继续' : '继续'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
