import { getSkinConfig, saveSkinConfig, type SkinConfig, type SkinTextureConfig } from './skin';
import { DEFAULT_TEXTURE } from './skin-config';
import { DEFAULT_VIDEO, type VideoBackgroundParams } from './skin-video-config';
import { persistSkinConfig } from './skin-persistence';
import { deleteBackgroundVideoFile, uploadBackgroundVideoFile, type VideoUploadOptions } from './skin-video';

type Apply = (next: SkinConfig) => void;

async function commitTexture(texture: SkinTextureConfig, onApply: Apply): Promise<void> {
  const previous = getSkinConfig().texture ?? DEFAULT_TEXTURE;
  const next = saveSkinConfig({ texture });
  onApply(next);
  try { await persistSkinConfig(next); }
  catch (cause) {
    onApply(saveSkinConfig({ texture: previous }));
    throw cause;
  }
}

export async function replaceBackgroundVideo(file: File, onApply: Apply, options?: VideoUploadOptions): Promise<string | undefined> {
  const id = await uploadBackgroundVideoFile(file, options);
  try {
    const current = getSkinConfig().texture ?? DEFAULT_TEXTURE;
    if (!current.layers.includes('video')) { await deleteBackgroundVideoFile(id); return; }
    const oldId = current.video?.id;
    await commitTexture({ ...current, video: { ...DEFAULT_VIDEO, ...current.video, id } }, onApply);
    if (oldId && oldId !== id) {
      try { await deleteBackgroundVideoFile(oldId); }
      catch { return '新视频已启用，但旧视频文件清理失败'; }
    }
  } catch (cause) {
    let cleanupFailed = false;
    if (getSkinConfig().texture?.video?.id !== id) {
      try { await deleteBackgroundVideoFile(id); }
      catch { cleanupFailed = true; }
    }
    const message = cause instanceof Error ? cause.message : '视频上传失败';
    throw new Error(cleanupFailed ? `${message}；临时视频清理失败` : message, { cause });
  }
}

export async function removeBackgroundVideo(onApply: Apply): Promise<void> {
  const texture = getSkinConfig().texture ?? DEFAULT_TEXTURE;
  const id = texture.video?.id;
  if (!id) return;
  try {
    await commitTexture({ ...texture, video: { ...DEFAULT_VIDEO, ...texture.video, id: undefined } }, onApply);
    await deleteBackgroundVideoFile(id);
  } catch (cause) {
    let restoreFailed = false;
    if (getSkinConfig().texture?.video?.id !== id) {
      try { await commitTexture(texture, onApply); }
      catch { restoreFailed = true; }
    }
    const message = cause instanceof Error ? cause.message : '视频移除失败';
    throw new Error(restoreFailed ? `${message}；原视频配置恢复失败` : message, { cause });
  }
}

export function patchBackgroundVideo(patch: Partial<VideoBackgroundParams>, onApply: Apply): void {
  const current = getSkinConfig().texture ?? DEFAULT_TEXTURE;
  onApply(saveSkinConfig({ texture: {
    ...current, video: { ...DEFAULT_VIDEO, ...current.video, ...patch },
  } }));
}
