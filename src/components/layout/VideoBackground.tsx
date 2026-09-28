import { useEffect, useRef } from 'react';
import type { VideoBackgroundParams } from '../../store/skin-video-config';
import { backgroundVideoUrl } from '../../store/skin-video';
import '../../styles/components/skin-video.css';

export default function VideoBackground({ params }: { params: VideoBackgroundParams }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = backgroundVideoUrl(params.id);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePlayback = () => {
      if (document.hidden || motion.matches) { video.pause(); return; }
      void video.play().catch(error => console.error('[skin] 视频背景播放失败:', error));
    };
    document.addEventListener('visibilitychange', updatePlayback);
    motion.addEventListener('change', updatePlayback);
    updatePlayback();
    return () => {
      document.removeEventListener('visibilitychange', updatePlayback);
      motion.removeEventListener('change', updatePlayback);
      video.pause();
    };
  }, [url]);

  if (!url) return null;
  return <video ref={videoRef} className="skin-video-background" src={url}
    muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
    style={{ objectFit: params.fit, opacity: params.opacity }}
    onError={() => console.error('[skin] 视频背景文件无法解码或读取:', url)} />;
}
