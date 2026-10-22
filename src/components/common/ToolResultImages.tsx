import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { toolImageUrl, type ToolImageRef, type ToolMediaScope } from '../../engine/tool-media';

export default function ToolResultImages({ images, scope }: {
  images: ToolImageRef[];
  scope: ToolMediaScope;
}) {
  if (!images.length) return null;
  return <div className="tool-result-images">
    {images.map(image => <ToolImage key={`${scope.feature}:${image.id}`} image={image} scope={scope} />)}
  </div>;
}

function ToolImage({ image, scope }: { image: ToolImageRef; scope: ToolMediaScope }) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = toolImageUrl(scope, image.id);
  return <figure className="tool-result-image">
    {failed ? <div className="tool-result-image__missing" role="status">
      <span>{english ? 'Image unavailable' : '图片暂时无法读取'}</span>
      <button type="button" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>
        {english ? 'Retry loading' : '重新加载'}
      </button>
    </div> : <a href={source} target="_blank" rel="noreferrer"
      title={english ? 'Open original image' : '查看原图'}>
      <img key={attempt} src={source} alt={image.name} loading="lazy" crossOrigin="use-credentials"
        referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>}
    <figcaption><span>{image.name}</span><span>{Math.max(1, Math.round(image.size / 1024))} KB</span></figcaption>
  </figure>;
}
