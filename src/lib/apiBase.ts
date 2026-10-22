import { backendOrigin, backendUrl } from './backend-client';

/** Retained for existing development configuration and its validation contract. */
export function resolveStreamBase(dev: boolean, configuredOrigin?: string): string {
  if (!dev || !configuredOrigin?.trim()) return '';
  const url = new URL(configuredOrigin.trim());
  if (url.protocol !== 'https:') throw new Error('VITE_STREAM_ORIGIN 必须使用 HTTPS');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('VITE_STREAM_ORIGIN 必须是 HTTPS origin');
  }
  return url.origin;
}

export const STREAM_BASE = backendOrigin();

/** Long streams use exactly the same backend connection as REST and files. */
export function streamUrl(path: string): string {
  return backendUrl(path);
}
