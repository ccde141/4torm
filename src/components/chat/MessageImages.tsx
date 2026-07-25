import type { ImageAttachment } from '../../types';
import type { ImageDraft } from '../../engine/chat/image-attachments';
import { attachmentUrl } from '../../engine/chat/image-attachments';

export function ImageDrafts({ images, onRemove }: {
  images: ImageDraft[];
  onRemove: (key: string) => void;
}) {
  if (!images.length) return null;
  return (
    <div className="chat__image-drafts" aria-label="待发送图片">
      {images.map(image => (
        <div className="chat__image-draft" key={image.key}>
          <img src={image.dataUrl} alt={image.name} />
          <button type="button" onClick={() => onRemove(image.key)} aria-label={`移除 ${image.name}`} title="移除图片">×</button>
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
      {images.map(image => {
        const src = attachmentUrl(agentId, sessionId, image.id);
        return (
          <a href={src} target="_blank" rel="noreferrer" key={image.id} title={`查看原图：${image.name}`}>
            <img src={src} alt={image.name} loading="lazy" />
          </a>
        );
      })}
    </div>
  );
}
