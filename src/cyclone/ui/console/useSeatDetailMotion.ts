import { useCallback, useLayoutEffect, useRef, useState } from 'react';

type DetailPhase = 'opening' | 'open' | 'closing';
type Bounds = { left: number; top: number; width: number; height: number };
type Frame = { left: string; top: string; width: string; height: string;
  opacity: string; clipPath: string; borderRadius: string };
interface DetailMotion {
  element: HTMLDialogElement;
  previous: HTMLElement | null;
  active: boolean;
  opened: boolean;
  closing: boolean;
  closed: boolean;
  transition: number;
  animation?: Animation;
  timer?: number;
  focusFrame?: number;
}

function sourceCard(seatId: string) {
  return document.querySelector<HTMLElement>('.cy-console-grid article[data-cy-seat-card="' + CSS.escape(seatId) + '"]');
}

/** Visibility decides whether to return to the card; its full bounds define the shape. */
function sourceFrame(seatId: string): Frame | undefined {
  const element = sourceCard(seatId);
  if (!element?.isConnected) return;
  const bounds = element.getBoundingClientRect();
  let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
  let right = Math.min(window.innerWidth, bounds.right), bottom = Math.min(window.innerHeight, bounds.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
    const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const clip = parent.getBoundingClientRect();
    if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
  }
  if (right <= left || bottom <= top) return;
  const crop = [top - bounds.top, bounds.right - right, bounds.bottom - bottom, left - bounds.left];
  return { ...frameAt(bounds), clipPath: 'inset(' + crop.map(value => Math.max(0, value) + 'px').join(' ') + ')',
    borderRadius: getComputedStyle(element).borderRadius };
}

function frameAt(bounds: Bounds, opacity = '1'): Frame {
  return { left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px',
    height: bounds.height + 'px', opacity, clipPath: 'inset(0px 0px 0px 0px)', borderRadius: '16px' };
}

function captureFrame(element: HTMLElement): Frame {
  const style = getComputedStyle(element);
  return { ...frameAt(element.getBoundingClientRect(), style.opacity),
    clipPath: style.clipPath === 'none' ? 'inset(0px 0px 0px 0px)' : style.clipPath,
    borderRadius: style.borderRadius };
}

function placeFrame(element: HTMLElement, frame: Frame) {
  Object.assign(element.style, { inset: 'auto', margin: '0', ...frame });
}

function clearFrame(element: HTMLElement) {
  for (const property of ['inset', 'margin', 'left', 'top', 'width', 'height', 'opacity', 'clip-path', 'border-radius',
    '--cy-detail-width', '--cy-detail-height']) element.style.removeProperty(property);
}

function prepareLayers(element: HTMLElement, detail: Frame, card?: Frame) {
  // The frame changes size; text inside either layer keeps its original layout.
  if (!element.style.getPropertyValue('--cy-detail-width')) element.style.setProperty('--cy-detail-width', detail.width);
  if (!element.style.getPropertyValue('--cy-detail-height')) element.style.setProperty('--cy-detail-height', detail.height);
  element.dataset.hasSource = String(Boolean(card));
  if (card) {
    element.style.setProperty('--cy-card-width', card.width);
    element.style.setProperty('--cy-card-height', card.height);
  }
}

function cancelMotion(motion: DetailMotion) {
  motion.transition += 1;
  window.clearTimeout(motion.timer);
  if (motion.focusFrame !== undefined) cancelAnimationFrame(motion.focusFrame);
  if (motion.animation) {
    motion.animation.onfinish = null;
    motion.animation.cancel();
    motion.animation = undefined;
  }
}

function restoreFocus(motion: DetailMotion, seatId: string) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    const vacant = !active || !active.isConnected || active === document.body
      || active === document.documentElement || motion.element.contains(active);
    if (!vacant || document.querySelector('dialog[open]')) return;
    const candidates = [motion.previous, sourceCard(seatId)?.querySelector<HTMLElement>('button:not(:disabled)')];
    const target = candidates.find(element => element?.isConnected && !element.closest('dialog, [inert], [hidden]')
      && !element.matches(':disabled') && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === 'visible');
    target?.focus({ preventScroll: true });
  });
}

function focusClose(motion: DetailMotion) {
  motion.focusFrame = requestAnimationFrame(() => {
    if (motion.active && !motion.closing && motion.element.open) {
      motion.element.querySelector<HTMLButtonElement>('.cy-seat-detail__close')?.focus({ preventScroll: true });
    }
  });
}

function playMotion(motion: DetailMotion, from: Frame, to: Frame, duration: number, complete: () => void) {
  let finished = false;
  const transition = ++motion.transition;
  const finish = () => {
    if (!motion.active || finished || motion.transition !== transition) return;
    finished = true;
    // Commit the last frame before releasing WAAPI fill, including the closing frame.
    placeFrame(motion.element, to);
    cancelMotion(motion);
    complete();
  };
  placeFrame(motion.element, from);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !motion.element.animate) {
    queueMicrotask(finish);
    return;
  }
  try {
    motion.animation = motion.element.animate([from, to], {
      duration, easing: 'cubic-bezier(.05,.7,.1,1)', fill: 'both',
    });
    motion.animation.onfinish = finish;
    motion.timer = window.setTimeout(finish, duration + 100);
  } catch { queueMicrotask(finish); }
}

/** The native modal stays open while its own card and detail layers exchange visibility. */
export function useSeatDetailMotion(seatId: string, onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef<DetailMotion | null>(null);
  const closeCallback = useRef(onClose);
  const [state, setState] = useState<{ seatId: string; phase: DetailPhase }>({ seatId, phase: 'opening' });
  const phase = state.seatId === seatId ? state.phase : 'opening';
  useLayoutEffect(() => { closeCallback.current = onClose; }, [onClose]);

  const finishClose = useCallback((motion: DetailMotion) => {
    if (!motion.active || motion.closed || current.current !== motion) return;
    cancelMotion(motion);
    motion.closed = true;
    motion.element.close();
    closeCallback.current();
    restoreFocus(motion, seatId);
  }, [seatId]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const motion: DetailMotion = { element, previous: document.activeElement instanceof HTMLElement
      ? document.activeElement : null, active: true, opened: false, closing: false, closed: false, transition: 0 };
    current.current = motion;
    const source = sourceFrame(seatId);
    element.showModal();
    const target = captureFrame(element);
    const settle = () => {
      cancelMotion(motion); clearFrame(element);
      motion.opened = true;
      setState({ seatId, phase: 'open' }); focusClose(motion);
    };
    prepareLayers(element, target, source);
    playMotion(motion, source ?? { ...target, opacity: '0' }, target, 480, settle);
    const resize = () => {
      // Resizing never sends a closing window back to the expanded destination.
      if (motion.closing) finishClose(motion);
      else if (!motion.opened) settle();
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      motion.active = false;
      cancelMotion(motion);
      if (element.open) element.close();
      clearFrame(element);
      if (!motion.closed) restoreFocus(motion, seatId);
      if (current.current === motion) current.current = null;
    };
  }, [seatId, finishClose]);

  const close = useCallback(() => {
    const motion = current.current;
    if (!motion?.active || motion.closing || motion.closed) return;
    // Read the currently painted frame before cancelling an interrupted opening.
    const from = captureFrame(motion.element);
    placeFrame(motion.element, from);
    cancelMotion(motion);
    motion.closing = true;
    const source = sourceFrame(seatId);
    prepareLayers(motion.element, from, source);
    setState({ seatId, phase: 'closing' });
    playMotion(motion, from, source ?? { ...from, opacity: '0' }, 420, () => finishClose(motion));
  }, [seatId, finishClose]);

  return { dialog, closing: phase === 'closing', phase, close };
}
