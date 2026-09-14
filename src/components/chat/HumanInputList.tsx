import type { ChatMessage } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import { summarizeSkippedInputNotice, type SkippedInputNotice as Notice } from './human-input-presentation';

function SkippedNotice({ notice }: { notice: Notice }) {
  return <div className="chat__human-input-skipped">
    {notice.prefix}<strong className="chat__human-input-skipped-names">{notice.names}</strong>{notice.reason}
  </div>;
}

export default function HumanInputList({ message }: { message: ChatMessage }) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const labels = english
    ? { received: 'Received · awaiting a safe boundary', included: 'Included in context', retained: 'Retained · not consumed' }
    : { received: '已接收 · 等待安全边界', included: '已纳入上下文', retained: '已保留 · 未消费' };
  const inputs = message.humanInputs ?? [];
  const skippedNotice = summarizeSkippedInputNotice(message.inputSkipped ?? [], english ? 'en-US' : 'zh-CN');
  if (!message.humanInputs?.length && !message.inputRecoveryError && !message.inputSkipped?.length) return null;
  return <section className="chat__human-inputs" aria-label={english ? 'Human steering' : '人类插话'}>
    {inputs.map((input, index) => <article className="chat__message chat__message--user chat__message--steering" key={input.id}>
      <div className="chat__avatar">{english ? 'You' : '你'}</div>
      <div className="chat__bubble">
        <div className="md-bubble">{input.content}</div>
        <div className={`chat__human-input-status chat__human-input-status--${input.state}`}>{labels[input.state]}</div>
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
