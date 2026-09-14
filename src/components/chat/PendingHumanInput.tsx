import type { InputDeliveryState, InputSubmission } from '../../engine/chat/input-submission';

const labels: Record<InputDeliveryState, [string, string]> = {
  sending: ['发送中', 'Sending'], received: ['已接收', 'Received'],
  queued: ['等待下一轮', 'Waiting for next turn'], included: ['已进入上下文', 'Included'],
  continued: ['已转入下一轮', 'Continued'], retained: ['消息已保留', 'Message retained'],
};

export default function PendingHumanInput({ pending, busy, english, onCheck }: {
  pending: { input: InputSubmission; state: InputDeliveryState; error?: string };
  busy: boolean; english: boolean; onCheck: () => void;
}) {
  return <div className="chat__input-area" aria-live="polite">
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pending.input.content}</div>
    <small role="status">{labels[pending.state][english ? 1 : 0]}</small>
    {pending.error && <div className="chat__image-error" role="alert">{pending.error}</div>}
    {!busy && <button type="button" className="btn btn-secondary" onClick={onCheck}>
      {english ? 'Check receipt and continue' : '核对接收状态并继续'}
    </button>}
  </div>;
}
