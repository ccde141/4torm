import type { ChatMessage } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import { humanInputStatus, summarizeSkippedInputNotice, type HumanInputActivity,
  type SkippedInputNotice as Notice } from './human-input-presentation';
import { HumanInputRecovery } from './PendingHumanInput';
import type { PendingInput } from '../../engine/chat/input-outbox';

function SkippedNotice({ notice }: { notice: Notice }) {
  return <div className="chat__human-input-skipped">
    {notice.prefix}<strong className="chat__human-input-skipped-names">{notice.names}</strong>{notice.reason}
  </div>;
}

export default function HumanInputList({ message, pending = [], isWorking, onCheck, activity }: {
  message: ChatMessage;
  pending?: readonly PendingInput[];
  isWorking?: (id: string) => boolean;
  onCheck?: (entry: PendingInput) => void;
  activity?: HumanInputActivity;
}) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const inputs = message.humanInputs ?? [];
  const skippedNotice = summarizeSkippedInputNotice(message.inputSkipped ?? [], english ? 'en-US' : 'zh-CN');
  if (!message.humanInputs?.length && !message.inputRecoveryError && !message.inputSkipped?.length) return null;
  return <section className="chat__human-inputs" aria-label={english ? 'Human steering' : '人类插话'}>
    {inputs.map((input, index) => <article className="chat__message chat__message--user chat__message--steering" key={input.id}>
      <div className="chat__avatar">{english ? 'You' : '你'}</div>
      <div className="chat__bubble">
        <div className="md-bubble">{input.content}</div>
        <div className={`chat__human-input-status chat__human-input-status--${input.state}`} role="status">
          {humanInputStatus(input.state, input.runId, english ? 'en-US' : 'zh-CN', activity)}
        </div>
        {input.state !== 'included' && onCheck && pending.filter(entry => entry.input.id === input.id
          && entry.input.runId === input.runId).map(entry => <HumanInputRecovery key={entry.input.id}
            pending={entry} busy={isWorking?.(entry.input.id) ?? false} english={english}
            onCheck={() => onCheck(entry)} />)}
        {index === inputs.length - 1 && skippedNotice && <SkippedNotice notice={skippedNotice} />}
      </div>
    </article>)}
    {!inputs.length && skippedNotice && <article className="chat__message chat__message--user chat__message--steering">
      <div className="chat__avatar">{english ? 'You' : '你'}</div>
      <div className="chat__bubble"><SkippedNotice notice={skippedNotice} /></div>
    </article>}
    {message.inputRecoveryError && <div className="chat__human-input-notice chat__human-input-error" role="alert">{english ? 'Input recovery failed; saved history is unchanged.' : '插话恢复失败，原有历史已保留。'} {message.inputRecoveryError}</div>}
  </section>;
}
