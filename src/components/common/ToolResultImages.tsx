import { toolImagePreviewUrl, toolImageUrl, type ToolImageRef, type ToolMediaScope } from '../../engine/tool-media';
import ImageReferencePreview from './ImageReferencePreview';

export default function ToolResultImages({ images, scope }: {
  images: ToolImageRef[];
  scope: ToolMediaScope;
}) {
  if (!images.length) return null;
  return <div className="tool-result-images">
    {images.map(image => <ImageReferencePreview key={`${scope.feature}:${image.id}`}
      source={toolImageUrl(scope, image.id)} preview={toolImagePreviewUrl(scope, image.id)}
      name={image.name} size={image.size} />)}
  </div>;
}
