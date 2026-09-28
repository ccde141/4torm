const VIDEO_ID = /^background-[a-f0-9-]+\.(mp4|webm)$/;

interface VideoFileInfo { name: string; type: string; size: number }
export interface VideoUploadOptions { signal?: AbortSignal; onProgress?: (loaded: number) => void }

export function validateBackgroundVideoFile(file: VideoFileInfo): 'video/mp4' | 'video/webm' {
  if (file.size <= 0) throw new Error('视频文件为空');
  const inferred = file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4'
    : file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : '';
  const type = file.type === 'video/mp4' || file.type === 'video/webm' ? file.type : inferred;
  if (type !== 'video/mp4' && type !== 'video/webm') throw new Error('请选择 MP4 或 WebM 视频');
  return type;
}

export function backgroundVideoUrl(id: string | undefined): string | undefined {
  return id && VIDEO_ID.test(id) ? `/api/skin-video/${id}` : undefined;
}

function parseVideoUploadResponse(status: number, text: string): string {
  let body: { id?: string; error?: string } = {};
  try { body = JSON.parse(text) as typeof body; } catch { /* HTTP error below has its own message. */ }
  if (status < 200 || status >= 300) throw new Error(body.error || `视频上传失败：HTTP ${status}`);
  if (!backgroundVideoUrl(body.id)) throw new Error('视频上传响应无效');
  return body.id!;
}

function uploadWithProgress(file: File, type: string, options: VideoUploadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('视频上传已取消')); return; }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error, id?: string) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(id!);
    };
    const onAbort = () => { xhr.abort(); finish(new Error('视频上传已取消')); };
    xhr.open('PUT', '/api/skin-video');
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = event => options.onProgress?.(Math.min(event.loaded, file.size));
    xhr.onload = () => {
      try { finish(undefined, parseVideoUploadResponse(xhr.status, xhr.responseText)); }
      catch (error) { finish(error as Error); }
    };
    xhr.onerror = () => finish(new Error('视频上传连接失败'));
    xhr.onabort = () => finish(new Error('视频上传已取消'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try { xhr.send(file); } catch (error) { finish(error as Error); }
  });
}

export async function uploadBackgroundVideoFile(file: File, options?: VideoUploadOptions): Promise<string> {
  const type = validateBackgroundVideoFile(file);
  if (options?.signal || options?.onProgress) return uploadWithProgress(file, type, options);
  const response = await fetch('/api/skin-video', { method: 'PUT', headers: { 'Content-Type': type }, body: file });
  return parseVideoUploadResponse(response.status, await response.text());
}

export async function deleteBackgroundVideoFile(id: string): Promise<void> {
  if (!backgroundVideoUrl(id)) throw new Error('视频标识无效');
  const response = await fetch(`/api/skin-video/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`视频删除失败：HTTP ${response.status}`);
}
