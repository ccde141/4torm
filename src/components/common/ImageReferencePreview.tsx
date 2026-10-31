import { useState, type CSSProperties } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { usePreviewVisibility } from '../../engine/media-display/usePreviewVisibility';
import { useToolImageResource } from '../../engine/media-display/useToolImageResource';
import { toolImageFailureKey } from '../../engine/media-display/tool-image-failure';
import ToolImageViewer from './ToolImageViewer';

export interface ImageReferencePreviewProps {
  source: string;
  preview: string;
  name: string;
  size: number;
  className?: string;
}

/** Only references are shared by human attachments and tool images; their owning APIs stay independent. */
export default function ImageReferencePreview({ source, preview, name, size, className }: ImageReferencePreviewProps) {
  const { t } = useLocale();
  const [viewing, setViewing] = useState(false);
  const { ref, active } = usePreviewVisibility();
  const resource = useToolImageResource(preview, active);
  const original = t('chat.images.open', { name });
  return <figure ref={ref} className={`tool-result-image${className ? ` ${className}` : ''}`}>
    <div style={frameStyle}>
      <a href={source} target="_blank" rel="noreferrer" title={original} aria-label={original}
        style={linkStyle} onClick={event => {
          if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); setViewing(true);
        }}>
        {active && resource.phase !== 'error' && <img key={`${preview}:${resource.attempt}`} src={preview} alt={name}
          decoding="async" crossOrigin="use-credentials" referrerPolicy="no-referrer"
          style={{ ...imageStyle, opacity: resource.phase === 'loaded' ? 1 : 0 }}
          onLoad={resource.onLoad} onError={resource.onError} />}
        {resource.phase !== 'loaded' && <span role={resource.phase === 'error' ? 'status' : undefined}
          style={placeholderStyle}>{resource.failure ? t(toolImageFailureKey(resource.failure))
            : active ? t('chat.images.previewLoading') : original}</span>}
      </a>
      {resource.phase === 'error' && resource.failure !== 'checking' &&
        <button type="button" style={retryStyle} onClick={resource.retry}>{t('chat.images.retry')}</button>}
    </div>
    <figcaption><span>{name}</span><span>{Math.max(1, Math.round(size / 1024))} KB</span></figcaption>
    {viewing && <ToolImageViewer source={source} name={name} owner={ref} onClose={() => setViewing(false)} />}
  </figure>;
}

const frameStyle: CSSProperties = { position: 'relative', width: '100%', aspectRatio: '4 / 3', maxHeight: 320 };
const linkStyle: CSSProperties = { position: 'absolute', inset: 0 };
const imageStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
const placeholderStyle: CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
  padding: 12, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 };
const retryStyle: CSSProperties = { position: 'absolute', right: 10, bottom: 10 };
