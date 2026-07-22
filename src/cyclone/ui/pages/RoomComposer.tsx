import type { RefObject } from 'react';
import ExecutionStatusBar from '../../../components/chat/ExecutionStatusBar';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';

export default function RoomComposer({ inputRef, input, streaming, phase, queue,
  onInput, onSend, onStop, onRemoveQueued }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  streaming: boolean;
  phase?: string;
  queue: string[];
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveQueued: (index: number) => void;
}) {
  return (
    <div className="chat__input-area">
      <ExecutionStatusBar label={streaming ? phase : undefined} />
      <QueuedChips items={queue} onRemove={onRemoveQueued} />
      <div className="chat__input-wrapper">
        <textarea ref={inputRef} className="chat__input" value={input}
          onChange={event => {
            onInput(event.target.value);
            event.target.style.height = 'auto';
            event.target.style.height = Math.min(event.target.scrollHeight, 200) + 'px';
          }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          placeholder={streaming ? '工位讨论中…（可继续输入，发送将排队）' : '在群里说点什么…（Enter 发送，Shift+Enter 换行）'}
          rows={1} aria-label="群聊发言" />
        <button className="chat__send-btn" onClick={onSend}
          disabled={!input.trim() || (streaming && queue.length >= MAX_QUEUE)}
          title={streaming ? queue.length >= MAX_QUEUE ? '队列已满（最多 3 条）' : '加入队列' : '发送'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
        {streaming && (
          <button className="chat__stop-btn" onClick={onStop} title="停止生成">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        )}
      </div>
      <div className="cyclone-room__input-hint">
        <span>快捷指令：</span><code>/reset</code><span>清空公共上下文</span>
        <code>/reset summary</code><span>摘要重置公共上下文</span>
        <code>/reset all</code><span>连同会长私聊一起清空</span>
      </div>
    </div>
  );
}
