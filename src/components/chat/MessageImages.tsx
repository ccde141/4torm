import { useState } from 'react';
import type { ImageAttachment } from '../../types';
import type { ImageDraft } from '../../engine/chat/image-attachments';
import { attachmentUrl } from '../../engine/chat/image-attachments';
import { useLocale } from '../../i18n/LocaleContext';

export function ImageDrafts({ images, onRemove }: {
  images: ImageDraft[];
  onRemove: (key: string) => void;
}) {
  const { t } = useLocale();
  if (!images.length) return null;
  return (
    <div className="chat__image-drafts" aria-label={t('chat.images.pending')}>
      {images.map(image => (
        <div className="chat__image-draft" key={image.key}>
          <img src={image.dataUrl} alt={image.name} />
          <button type="button" onClick={() => onRemove(image.key)} aria-label={t('chat.images.remove', { name: image.name })} title={t('chat.images.removeTitle')}>×</button>
        </div>
      ))}
    </div>
  );
}

export function MessageImages({ images, agentId, sessionId }: {
  images: ImageAttachment[];
  agentId: string;
  sessionId: string;
}) {
  if (!images.length) return null;
  return (
    <div className={`chat__message-images chat__message-images--${images.length}`}>
      {images.map(image => <MessageImage key={image.id} image={image}
        agentId={agentId} sessionId={sessionId} />)}
    </div>
  );
}

function MessageImage({ image, agentId, sessionId }: {
  image: ImageAttachment;
  agentId: string;
  sessionId: string;
}) {
  const { t } = useLocale();
  const [missing, setMissing] = useState(false);
  if (missing) {
    return <div className="chat__message-image-missing" role="status">
      <span aria-hidden="true">×</span>
      <span>{t('chat.images.missing', { name: image.name })}</span>
    </div>;
  }
  const src = attachmentUrl(agentId, sessionId, image.id);
  return <a href={src} target="_blank" rel="noreferrer"
    title={t('chat.images.open', { name: image.name })}>
    <img src={src} alt={image.name} loading="lazy" onError={() => setMissing(true)} />
  </a>;
}
