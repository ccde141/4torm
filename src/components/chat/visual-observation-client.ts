export type VisualObservationScope = 'conversation' | 'cyclone';
export type VisualObservationStatus = 'running' | 'waiting' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'crashed';
export type VisualObservationControl = 'agent' | 'human';
export type VisualObservationPresentation = 'embedded-visible' | 'external-visible' | 'hidden';

export interface VisualObservationOwner {
  scope: VisualObservationScope;
  ownerId: string;
}

export interface VisualObservationDetail {
  id: string;
  command: string;
  startedAt: number;
  finishedAt?: number;
  status: VisualObservationStatus;
  error?: string;
  viewerState?: {
    control: VisualObservationControl;
    revision: number;
    summary?: string;
    frameUpdatedAt?: number;
    presentation?: VisualObservationPresentation;
  };
}

export type ObservationFetch = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: ObservationFetch = (url, init) => fetch(url, init);

export function observationOwnerQuery(owner: VisualObservationOwner): string {
  return new URLSearchParams({ scope: owner.scope, ownerId: owner.ownerId }).toString();
}

export function visualObservationFrameUrl(
  id: string,
  owner: VisualObservationOwner,
  revision: number,
): string {
  return `${observationUrl(id)}/frame?${observationOwnerQuery(owner)}&v=${revision}`;
}

export function isActiveObservationStatus(status: VisualObservationStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'cancelling';
}

export async function readVisualObservation(
  id: string,
  owner: VisualObservationOwner,
  signal?: AbortSignal,
  fetcher: ObservationFetch = defaultFetch,
): Promise<VisualObservationDetail> {
  const response = await fetcher(`${observationUrl(id)}?${observationOwnerQuery(owner)}`, { signal });
  if (!response.ok) throw new Error(await responseError(response, 'Unable to read execution surface'));
  return (await response.json() as { item: VisualObservationDetail }).item;
}

export async function setVisualObservationControl(
  id: string,
  owner: VisualObservationOwner,
  control: VisualObservationControl,
  signal?: AbortSignal,
  fetcher: ObservationFetch = defaultFetch,
): Promise<void> {
  const response = await fetcher(`${observationUrl(id)}/control?${observationOwnerQuery(owner)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ control }),
    signal,
  });
  if (!response.ok) throw new Error(await responseError(response, '无法切换操作权'));
}

export async function requestVisualObservationRefresh(
  id: string,
  owner: VisualObservationOwner,
  signal?: AbortSignal,
  fetcher: ObservationFetch = defaultFetch,
): Promise<void> {
  const response = await fetcher(`${observationUrl(id)}/refresh?${observationOwnerQuery(owner)}`, { method: 'POST', signal });
  if (!response.ok) throw new Error(await responseError(response, '无法刷新运行画面'));
}

function observationUrl(id: string): string {
  return `/api/tools/observations/${encodeURIComponent(id)}`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json() as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}
