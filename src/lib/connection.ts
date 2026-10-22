import { backendFetch } from './backend-client';

export interface BackendHandshake {
  protocolVersion: 1;
  authentication: { required: boolean; authenticated: boolean };
  identity: { id: string } | null;
  capabilities: {
    providerRuntime: 'backend'; serverPlatform: string;
    desktopBrowser: boolean; localFilePaths: boolean;
  };
}

export async function readBackendConnection(): Promise<BackendHandshake> {
  return connectionRequest();
}

export async function signInBackend(token: string): Promise<BackendHandshake> {
  return connectionRequest('/session', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
}

async function connectionRequest(path = '', init?: RequestInit): Promise<BackendHandshake> {
  const response = await backendFetch(`/api/connection${path}`, {
    ...init, cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) throw new Error('此后端尚不支持当前连接协议，请先更新后端。 / Update the backend to connect.');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof detail === 'string' ? detail : `连接失败 / Connection failed (HTTP ${response.status})`);
  }
  if (!isHandshake(body)) throw new Error('前后端连接协议不兼容。 / Incompatible backend connection protocol.');
  return body;
}

function isHandshake(value: unknown): value is BackendHandshake {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<BackendHandshake>;
  return body.protocolVersion === 1 && body.capabilities?.providerRuntime === 'backend'
    && typeof body.capabilities.serverPlatform === 'string'
    && typeof body.capabilities.desktopBrowser === 'boolean'
    && typeof body.capabilities.localFilePaths === 'boolean'
    && typeof body.authentication?.required === 'boolean'
    && typeof body.authentication.authenticated === 'boolean'
    && (!body.authentication.authenticated || typeof body.identity?.id === 'string');
}
