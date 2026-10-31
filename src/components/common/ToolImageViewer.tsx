import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { toolImageFailureKey } from '../../engine/media-display/tool-image-failure';
import { usePreviewVisibility } from '../../engine/media-display/usePreviewVisibility';
import { useToolImageResource } from '../../engine/media-display/useToolImageResource';
import { observePreviewVisibility } from '../../engine/media-display/preview-visibility';
import { useImageViewerDialog } from '../../engine/media-display/useImageViewerDialog';

/** Original bytes are requested only after an explicit open, and released when this dialog is hidden. */
export default function ToolImageViewer({ source, name, onClose, owner }: {
  source: string; name: string; onClose(): void; owner?: RefObject<HTMLElement | null>;
}) {
  const { t } = useLocale();
  const { dialog, closeButton, closing, close, finish } = useImageViewerDialog(onClose);
  const backdropPress = useRef(false);
  const visibility = usePreviewVisibility<HTMLDivElement>(1);
  const resource = useToolImageResource(source, visibility.active);
  useEffect(() => {
    const element = owner?.current;
    if (element) return observePreviewVisibility(element, () => {}, { onHidden: finish });
  }, [owner, finish]);
  const content = <dialog ref={dialog} className="tool-image-viewer" tabIndex={-1}
    data-phase={closing ? 'closing' : 'open'} aria-label={t('chat.images.open', { name })}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onClose={() => { if (dialog.current && !dialog.current.open) finish(); }}
    onKeyDown={event => event.stopPropagation()}
    onAnimationEnd={event => { if (event.target === event.currentTarget && closing) finish(); }}
    onPointerDown={event => {
      event.stopPropagation();
      backdropPress.current = event.target === event.currentTarget && outsideDialog(event.currentTarget, event.clientX, event.clientY);
    }} onClick={event => {
      event.stopPropagation();
      if (backdropPress.current && event.target === event.currentTarget
        && outsideDialog(event.currentTarget, event.clientX, event.clientY)) close();
      backdropPress.current = false;
    }}>
    <header className="tool-image-viewer__header">
      <span className="tool-image-viewer__badge" aria-hidden="true"><ImageSymbol /></span>
      <div className="tool-image-viewer__identity"><span>{t('chat.images.original')}</span><strong title={name}>{name}</strong></div>
      <nav className="tool-image-viewer__actions" aria-label={t('chat.images.actions')}>
        <a href={source} target="_blank" rel="noreferrer" className="tool-image-viewer__action"
          title={t('chat.images.newTab')} aria-label={t('chat.images.newTab')}
          aria-disabled={closing || undefined} tabIndex={closing ? -1 : undefined}
          onClick={event => { if (closing) event.preventDefault(); }}><ExternalSymbol /></a>
        <button ref={closeButton} type="button" disabled={closing} onClick={close}
          className="tool-image-viewer__action tool-image-viewer__close"
          title={t('chat.images.closeViewer')} aria-label={t('chat.images.closeViewer')}><CloseSymbol /></button>
      </nav>
    </header>
    <div ref={visibility.ref} className="tool-image-viewer__stage" aria-busy={resource.phase === 'loading'}>
      {visibility.active && resource.phase !== 'error' && <img key={resource.attempt} src={source} alt={name}
        crossOrigin="use-credentials" referrerPolicy="no-referrer" decoding="async"
        onLoad={resource.onLoad} onError={resource.onError}
        className="tool-image-viewer__image" data-loaded={resource.phase === 'loaded'} />}
      {resource.phase !== 'loaded' && <div role="status" className="tool-image-viewer__notice">
        {resource.phase !== 'error' && <span className="tool-image-viewer__spinner" aria-hidden="true" />}
        <span>{resource.failure ? t(toolImageFailureKey(resource.failure, true)) : t('chat.images.originalLoading')}</span>
        {resource.phase === 'error' && resource.failure !== 'checking' &&
          <button type="button" disabled={closing} onClick={resource.retry}
            className="tool-image-viewer__retry"><ReloadSymbol />{t('chat.images.retry')}</button>}
      </div>}
    </div>
  </dialog>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function outsideDialog(element: HTMLDialogElement, x: number, y: number) {
  const rect = element.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}
function ImageSymbol() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 16 5-5 4 4 4-4 5 5" /></svg>; }
function ExternalSymbol() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>; }
function CloseSymbol() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }
function ReloadSymbol() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5" /></svg>; }
