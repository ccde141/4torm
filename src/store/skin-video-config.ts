export interface VideoBackgroundParams {
  id?: string;
  fit: 'cover' | 'contain';
  opacity: number;
}

export const DEFAULT_VIDEO: VideoBackgroundParams = { fit: 'cover', opacity: 0.38 };
