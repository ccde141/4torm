import type { InputDeliveryState, InputSubmission } from '../../engine/chat/input-submission';
import { humanInputStatus, type HumanInputActivity } from './human-input-presentation';

interface PendingHumanInputProps {
  pending: { input: InputSubmission; state: InputDeliveryState; error?: string };
  busy: boolean; english: boolean; onCheck: () => void;
  activity?: HumanInputActivity;
}

export function HumanInputRecovery({ pending, busy, english, onCheck }: PendingHumanInputProps) {
  if (pending.state !== 'retained') return null;
  return <>
    {pending.error && <div className="chat__image-error" role="alert">{pending.error}</div>}
    {!busy && <button type="button" className="btn btn-secondary" onClick={onCheck}>
      {english ? 'Check receipt and continue' : '核对接收状态并继续'}
    </button>}
  </>;
}

export default function PendingHumanInput(props: PendingHumanInputProps) {
  const { pending, english } = props;
  return <article className="chat__message chat__message--user chat__message--steering" aria-live="polite">
    <div className="chat__avatar">{english ? 'You' : '你'}</div>
    <div className="chat__bubble">
      <div className="md-bubble">{pending.input.content}</div>
      <div className={`chat__human-input-status chat__human-input-status--${pending.state}`} role="status">
        {humanInputStatus(pending.state, pending.input.runId, english ? 'en-US' : 'zh-CN', props.activity)}
      </div>
      <HumanInputRecovery {...props} />
    </div>
  </article>;
}
