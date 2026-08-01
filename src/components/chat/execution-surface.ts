import { findExecutionSurfaceCapability, getExecutionSurfaceCapability } from './execution-surface-capability';

export interface ExecutionSurfaceItem {
  id: string;
  surfaceId?: string;
  viewer?: 'terminal' | 'browser' | 'computer';
  presentation?: 'embedded-visible' | 'external-visible' | 'hidden';
  command: string;
  status: string;
  startedAt: number;
}

export interface ExecutionSurfaceState {
  ownerKey: string;
  openIds: string[];
  activeId: string | null;
  visible: boolean;
}

export type ExecutionSurfaceAction =
  | { type: 'reset-owner'; ownerKey: string }
  | { type: 'open'; ownerKey: string; id: string }
  | { type: 'select'; ownerKey: string; id: string }
  | { type: 'close-tab'; ownerKey: string; id: string }
  | { type: 'hide'; ownerKey: string }
  | { type: 'show'; ownerKey: string }
  | { type: 'reconcile'; ownerKey: string; items: ExecutionSurfaceItem[] };

export function createExecutionSurfaceState(ownerKey: string): ExecutionSurfaceState {
  return { ownerKey, openIds: [], activeId: null, visible: false };
}

export function executionSurfaceReducer(
  state: ExecutionSurfaceState,
  action: ExecutionSurfaceAction,
): ExecutionSurfaceState {
  if (action.type === 'reset-owner') {
    return action.ownerKey === state.ownerKey ? state : createExecutionSurfaceState(action.ownerKey);
  }
  if (action.ownerKey !== state.ownerKey) return state;

  if (action.type === 'open') {
    const openIds = state.openIds.includes(action.id) ? state.openIds : [...state.openIds, action.id];
    return { ...state, openIds, activeId: action.id, visible: true };
  }
  if (action.type === 'select') {
    return state.openIds.includes(action.id) ? { ...state, activeId: action.id } : state;
  }
  if (action.type === 'hide') return { ...state, visible: false };
  if (action.type === 'show') {
    return state.openIds.length ? { ...state, activeId: state.activeId ?? state.openIds[0], visible: true } : state;
  }
  if (action.type === 'close-tab') return closeExecutionSurfaceTab(state, action.id);
  return reconcileExecutionSurface(state, action.items);
}

function closeExecutionSurfaceTab(state: ExecutionSurfaceState, id: string): ExecutionSurfaceState {
  const index = state.openIds.indexOf(id);
  if (index < 0) return state;
  const openIds = state.openIds.filter(openId => openId !== id);
  if (!openIds.length) return { ...state, openIds, activeId: null, visible: false };
  if (state.activeId !== id) return { ...state, openIds };
  return { ...state, openIds, activeId: openIds[Math.min(index, openIds.length - 1)] };
}

function reconcileExecutionSurface(
  state: ExecutionSurfaceState,
  items: ExecutionSurfaceItem[],
): ExecutionSurfaceState {
  const availableIds = new Set(items.filter(isSupportedSurface).map(item => item.id));
  const openIds = state.openIds.filter(id => availableIds.has(id));
  const activeId = state.activeId && openIds.includes(state.activeId) ? state.activeId : openIds.at(-1) ?? null;
  return { ...state, openIds, activeId, visible: openIds.length ? state.visible : false };
}

export function selectExecutionSurfaceTabs(items: ExecutionSurfaceItem[]): ExecutionSurfaceItem[] {
  return items
    .filter(item => {
      const capability = findExecutionSurfaceCapability(item.viewer);
      return capability && (capability.retainAfterCompletion || isActive(item));
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function selectOpenExecutionSurfaceItems(
  items: ExecutionSurfaceItem[],
  openIds: readonly string[],
): ExecutionSurfaceItem[] {
  const byId = new Map(items.filter(isSupportedSurface).map(item => [item.id, item]));
  return openIds.flatMap(id => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function shouldUseNativeExecutionSurface(
  item: ExecutionSurfaceItem,
  desktopAvailable: boolean,
): boolean {
  if (!desktopAvailable) return false;
  if (getExecutionSurfaceCapability(item.viewer).renderMode !== 'native-when-embedded') return false;
  // Electron removes a browser surface when its execution ends. Retained or
  // briefly stale observation records must never try to attach that surface again.
  if (!isActive(item)) return false;
  if (item.presentation !== undefined) return item.presentation === 'embedded-visible';
  return true;
}

export function resolveExecutionSurfaceSelection(
  items: ExecutionSurfaceItem[],
  selectedId?: string | null,
): ExecutionSurfaceItem | undefined {
  const tabs = selectExecutionSurfaceTabs(items);
  if (selectedId) return tabs.find(item => item.id === selectedId) ?? tabs.at(-1);
  return tabs.find(isPrimaryVisual)
    ?? tabs.filter(isActive).at(-1)
    ?? tabs.at(-1);
}

export function selectCurrentExecutionSurface(items: ExecutionSurfaceItem[]): ExecutionSurfaceItem | undefined {
  return resolveExecutionSurfaceSelection(items);
}

export function canTerminateExecution(item: ExecutionSurfaceItem): boolean {
  return isActive(item);
}

function isPrimaryVisual(item: ExecutionSurfaceItem): boolean {
  return isActive(item) && item.surfaceId === 'primary'
    && getExecutionSurfaceCapability(item.viewer).renderMode !== 'terminal';
}

function isSupportedSurface(item: ExecutionSurfaceItem): boolean {
  return Boolean(findExecutionSurfaceCapability(item.viewer));
}

function isActive(item: ExecutionSurfaceItem): boolean {
  return item.status === 'running' || item.status === 'waiting' || item.status === 'cancelling';
}
