import { useEffect, useRef, useState } from 'react';
import { formatObservationElapsed } from './taskboard-observations';
import { useVisualObservation } from './useVisualObservation';
import { isActiveObservationStatus } from './visual-observation-client';
import { useLocale } from '../../i18n/LocaleContext';
import { getDesktopExecutionSurface } from '../../lib/desktop';

type Scope = 'conversation' | 'cyclone';

export default function NativeObservationView({ scope, ownerId, observationId, onBack, suspended = false }: { scope: Scope; ownerId: string; observationId: string; onBack: () => void; suspended?: boolean }) {
  const { t } = useLocale();
  const [surfaceError, setSurfaceError] = useState('');
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [surfaceAttempt, setSurfaceAttempt] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const { item: currentItem, observedAt, error: observationError, control, frameUrl: frame } = useVisualObservation({
    scope,
    ownerId,
    observationId,
    refreshActiveObservation: true,
  });
  const humanControlled = currentItem?.viewerState?.control === 'human';
  const presentation = currentItem?.viewerState?.presentation;
  // The detail poll can reach a terminal state before the parent observation
  // snapshot refreshes. Drop visibility here too so the effect cancels retries.
  const desktopSurface = getDesktopExecutionSurface();
  const nativeSurface = Boolean(!suspended && desktopSurface && currentItem && isActiveObservationStatus(currentItem.status) && presentation !== 'hidden' && presentation !== 'external-visible');
  const terminalError = currentItem?.status === 'failed' || currentItem?.status === 'crashed' ? currentItem.error || t('chat.execution.browserFailed') : '';
  const fatalError = surfaceError || terminalError || observationError;
  const surfacePhase: 'opening' | 'ready' | 'failed' = surfaceReady ? 'ready' : fatalError ? 'failed' : 'opening';

  useEffect(() => {
    setSurfaceReady(false); setSurfaceError('');
    // Every mount attempt gets a new lease so a late hide from an older effect
    // cannot detach a surface that a newer effect has already shown.
    const leaseId = createSurfaceLease();
    return syncNativeSurface(observationId, stageRef.current, nativeSurface, leaseId, () => {
      setSurfaceReady(true); setSurfaceError('');
    }, cause => setSurfaceError(cause), t('chat.execution.displayFailed'));
  }, [observationId, nativeSurface, surfaceAttempt, t]);
  useEffect(() => {
    if (!nativeSurface || !surfaceReady || !desktopSurface) return;
    void desktopSurface.setInputEnabled(observationId, humanControlled).catch(cause => {
      if (isTransientSurfaceError(cause)) { setSurfaceReady(false); setSurfaceAttempt(value => value + 1); return; }
      setSurfaceError((cause as Error).message || t('chat.execution.controlFailed'));
    });
  }, [observationId, nativeSurface, surfaceReady, humanControlled, t, desktopSurface]);

  return <div style={shell}><header style={header}><button className="execution-surface-action" onClick={onBack} style={button}>{t('chat.execution.back')}</button><div style={{ minWidth: 0, flex: 1 }}><strong style={{ fontSize: 'var(--text-xs)' }}>{surfacePhase === 'opening' ? t('chat.execution.opening') : humanControlled ? t('chat.execution.humanControl') : t('chat.execution.agentControl')}</strong><div style={sub}>{currentItem?.viewerState?.summary || currentItem?.command || t('chat.execution.preparingBrowser')}</div></div><span style={sub}>{currentItem && formatObservationElapsed(currentItem.startedAt, currentItem.finishedAt ?? observedAt)}</span><button className="execution-surface-action" onClick={() => void control(humanControlled ? 'agent' : 'human')} style={button}>{humanControlled ? t('chat.execution.giveAgentControl') : t('chat.execution.giveHumanControl')}</button></header><div ref={stageRef} style={stage}>{surfacePhase === 'opening' && <div className="execution-surface-loading" style={loadingStyle}>{t('chat.execution.openingBrowser')}{observationError ? t('chat.execution.waitingStatus') : ''}</div>}{surfacePhase === 'failed' && <div className="mo-enter-fade" style={errorStyle}>{fatalError}</div>}{desktopSurface ? null : <img src={frame} style={image} onError={() => setSurfaceError(t('chat.execution.noBrowserFrame'))} />}</div></div>;
}

function syncNativeSurface(id: string, stage: HTMLDivElement | null, visible: boolean, leaseId: string, onReady: () => void, onError: (message: string) => void, fallbackError: string): void | (() => void) {
  const surface = getDesktopExecutionSurface();
  if (!visible || !stage || !surface) return;
  let stopped = false;
  let retry: number | undefined;
  const update = async () => {
    const rect = stage.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) { retry = window.setTimeout(update, 120); return; }
    try {
      await surface.show(id, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, leaseId);
      if (!stopped) onReady();
    } catch (cause) {
      if (stopped) return;
      if (isTransientSurfaceError(cause)) { retry = window.setTimeout(update, 120); return; }
      onError((cause as Error).message || fallbackError);
    }
  };
  const observer = new ResizeObserver(() => { void update(); });
  observer.observe(stage); void update();
  return () => { stopped = true; observer.disconnect(); if (retry !== undefined) window.clearTimeout(retry); void surface.hide(id, leaseId); };
}

function isTransientSurfaceError(cause: unknown): boolean {
  return /surface not found|desktop window is not available|surface bounds are invalid/i.test((cause as Error).message || '');
}

function createSurfaceLease(): string {
  return `surface-${crypto.randomUUID()}`;
}

const shell: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 };
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', borderBottom: '1px solid var(--glass-border)' };
const stage: React.CSSProperties = { position: 'relative', flex: 1, minHeight: 0, background: 'rgba(5,15,22,.72)' };
const button: React.CSSProperties = { appearance: 'none', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', cursor: 'pointer', fontSize: 'var(--text-xs)' };
const sub: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 2 };
const image: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
const errorStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--space-3)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' };
const loadingStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' };
