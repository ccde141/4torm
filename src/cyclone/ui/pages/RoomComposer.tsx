import { useEffect, type RefObject } from 'react';
import ExecutionStatusBar from '../../../components/chat/ExecutionStatusBar';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import { useLocale } from '../../../i18n/LocaleContext';

export default function RoomComposer({ inputRef, input, streaming, phase, queue,
  onInput, onSend, onStop, onRemoveQueued, disabled = false }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  streaming: boolean;
  disabled?: boolean;
  phase?: string;
  queue: string[];
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveQueued: (index: number) => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    if (!input) inputRef.current?.style.removeProperty('height');
  }, [input, inputRef]);

  return (
    <div className="chat__input-area">
      <ExecutionStatusBar label={streaming || disabled ? phase : undefined} />
      <QueuedChips items={queue} onRemove={onRemoveQueued} />
      <div className="chat__input-wrapper">
        <textarea ref={inputRef} className="chat__input" value={input}
          onChange={event => {
            onInput(event.target.value);
            event.target.style.height = 'auto';
            event.target.style.height = Math.min(event.target.scrollHeight, 200) + 'px';
          }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          placeholder={streaming ? t('cyclone.composer.streamingPlaceholder') : t('cyclone.composer.placeholder')}
          rows={1} aria-label={t('cyclone.composer.label')} />
        <button className="chat__send-btn" onClick={onSend}
          disabled={disabled || !input.trim() || (streaming && queue.length >= MAX_QUEUE)}
          title={streaming ? queue.length >= MAX_QUEUE ? t('cyclone.composer.queueFull') : t('cyclone.composer.enqueue') : t('cyclone.composer.send')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
        {streaming && (
          <button className="chat__stop-btn" onClick={onStop} title={t('cyclone.composer.stop')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        )}
      </div>
      <div className="cyclone-room__input-hint">
        <span>{t('cyclone.composer.commands')}</span><code>/reset</code><span>{t('cyclone.composer.reset')}</span>
        <code>/compact</code><span>{t('cyclone.composer.resetSummary')}</span>
        <code>/reset all</code><span>{t('cyclone.composer.resetAll')}</span>
      </div>
    </div>
  );
}
