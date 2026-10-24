/**
 * 原生思考流展示块。
 *
 * 显示模型的原生 reasoning 通道（reasoning_content/reasoning/thinking），
 * 与正文物理分开。无原生思考的模型 reasoningContent 为空 → 不渲染。
 *
 * 常规模式：流式期间展开，落定后折叠；预览模式：默认限高可见，折叠与高度独立控制。
 */

import { useId, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { reasoningSegments } from '../../engine/chat/stream-retention';
import BoundedText from '../../engine/text-display/BoundedText';
import { needsTextPaging } from '../../engine/text-display/text-pages';
import { useProcessFade } from './useProcessFade';
import './turn-process.css';
import './reasoning-preview.css';

interface Props {
  reasoning: string;
  breaks?: number[];
  /** 是否正在流式输出（决定光标 + 默认展开态） */
  isStreaming: boolean;
  /**
   * 覆盖默认展开态。不传时：流式默认展开、落定默认折叠（对话/工位用）。
   * 仅影响常规模式；预览模式默认展开正文。
   */
  defaultOpen?: boolean;
  /** Show a scrollable preview with separate visibility and height controls. */
  preview?: boolean;
}

export default function ReasoningBlock({ reasoning, isStreaming, defaultOpen, breaks, preview = false }: Props) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const { t, locale } = useLocale();
  const id = useId();
  const expanded = manualOpen ?? false;
  const { viewport, content } = useProcessFade(!!reasoning && preview && previewOpen, expanded, preview && isStreaming);
  if (!reasoning) return null;

  // 默认态：显式 defaultOpen 优先，否则流式展开/落定折叠。用户手动点过以手动为准。
  const open = preview ? previewOpen : (manualOpen ?? defaultOpen ?? isStreaming);
  const heightLabel = expanded ? (locale === 'en-US' ? 'Limit height' : '限高预览')
    : (locale === 'en-US' ? 'Full height' : '完整高度');

  return (
    <div className={`reasoning-block${open ? ' reasoning-block--open' : ''}${preview ? ' reasoning-block--preview' : ''}`}>
      <div className={preview ? 'reasoning-block__toolbar' : undefined}>
      <button
        type="button"
        className="reasoning-block__header"
        onClick={() => preview ? setPreviewOpen(value => !value) : setManualOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="reasoning-block__arrow" aria-hidden="true">{open ? '▼' : '▶'}</span>
        {preview && <svg className="reasoning-block__icon" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 18V5M9 3a3 3 0 0 0-3 3v1a4 4 0 0 0-2 7 4 4 0 0 0 2 7 3 3 0 0 0 6-1 3 3 0 0 0 6 1 4 4 0 0 0 2-7 4 4 0 0 0-2-7V6a3 3 0 0 0-6-1M8 10a3 3 0 0 1-2-3M16 10a3 3 0 0 0 2-3" />
        </svg>}
        <span className="reasoning-block__label">
          {isStreaming ? t('chat.reasoning.active') : t('chat.reasoning.done')}
        </span>
        {isStreaming && <span className="reasoning-block__spinner" />}
      </button>
      {preview && open && <button type="button" className="reasoning-block__height-control"
        aria-controls={id} aria-pressed={expanded} onClick={() => setManualOpen(!expanded)}>{heightLabel}</button>}
      </div>
      {(preview || open) && (
        <div id={id} ref={preview ? viewport : undefined} hidden={preview && !open}
          className={`reasoning-block__body${preview ? ' reasoning-block__preview-body' : ''}${preview && expanded ? ' is-expanded' : ''}`}
          tabIndex={preview ? 0 : undefined} role={preview ? 'region' : undefined}
          aria-label={preview ? t('chat.reasoning.done') : undefined}>
          <div ref={preview ? content : undefined}>
            {needsTextPaging(reasoning)
              ? <BoundedText text={reasoning} followTail={isStreaming} />
              : reasoningSegments(reasoning, breaks).map((text, index) => <span key={index}>
              {index > 0 && <hr className="turn-process-reasoning-divider" />}{text}
            </span>)}
            {isStreaming && <span className="thinking-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}
