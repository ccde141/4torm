import { useState } from 'react';
import type { Envelope } from '../../types/sandbox';
import { serializeEnvelope } from '../../engine/sandbox/envelope';

interface Props {
  nodeName: string;
  envelope: Envelope;
  prompt: string;
  onContinue: (modifiedEnvelope: Envelope) => void;
  onTerminate: () => void;
}

export default function HumanGateDialog({ nodeName, envelope, prompt, onContinue, onTerminate }: Props) {
  const [editInput, setEditInput] = useState(envelope.input);
  const [editContext, setEditContext] = useState(envelope.context);

  const handleContinue = () => {
    const modified = { ...envelope };
    modified.input = editInput;
    modified.context = editContext;
    onContinue(modified);
  };

  return (
    <div className="sandbox-node-config-popup" role="dialog" aria-modal="true" aria-label="人工确认">
      <div className="sandbox-node-config-inner" style={{ maxWidth: '600px', maxHeight: '80vh', overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-lg)', color: 'var(--color-warning)' }}>
          👤 人工介入 — {nodeName}
        </h3>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
          {prompt}
        </p>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label className="sandbox-sidebar-label">当前上下文</label>
          <textarea
            className="sandbox-node-config-textarea"
            rows={4}
            value={editContext}
            onChange={e => setEditContext(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label className="sandbox-sidebar-label">输入内容（可修改）</label>
          <textarea
            className="sandbox-node-config-textarea"
            rows={6}
            value={editInput}
            onChange={e => setEditInput(e.target.value)}
          />
        </div>

        <details style={{ marginBottom: 'var(--space-4)' }}>
          <summary style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}>
            查看完整信封
          </summary>
          <pre style={{
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-tertiary)',
            background: 'var(--color-bg)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            maxHeight: '200px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {serializeEnvelope(envelope)}
          </pre>
        </details>

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button className="sandbox-btn" onClick={onTerminate}
            style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
            终止
          </button>
          <button className="sandbox-btn sandbox-btn-primary" onClick={handleContinue}>
            继续执行
          </button>
        </div>
      </div>
    </div>
  );
}
