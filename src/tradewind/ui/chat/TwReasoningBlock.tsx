import { useEffect, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';

export default function TwReasoningBlock({ content, streaming }: {
  content: string;
  streaming: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  return (
    <div className={`tw-chat-reasoning${streaming ? ' tw-chat-reasoning--streaming' : ''}`}>
      <button className="tw-chat-reasoning__trigger" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="tw-chat-reasoning__mark">✦</span>
        <span>{streaming ? t('tradewind.chat.reasoning.running') : t('tradewind.chat.reasoning.title')}</span>
        <span className={`tw-chat-reasoning__arrow${open ? ' tw-chat-reasoning__arrow--open' : ''}`}>›</span>
      </button>
      {open && <div className="tw-chat-reasoning__body">{content}</div>}
    </div>
  );
}
