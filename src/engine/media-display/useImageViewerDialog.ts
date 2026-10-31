import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface ViewerControl { close(): void; finish(): void }

/** Keep the native modal in the top layer throughout exit, then release it and restore its opener. */
export function useImageViewerDialog(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const control = useRef<ViewerControl | null>(null);
  const onClosed = useRef(onClose);
  onClosed.current = onClose;
  const [closing, setClosing] = useState(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    let live = true, leaving = false, finished = false;
    let timer: number | undefined;
    const finish = () => {
      if (!live || finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (element.open) element.close();
      onClosed.current();
      restoreOpener(previous, element);
    };
    const close = () => {
      if (!live || leaving || finished) return;
      leaving = true;
      setClosing(true);
      element.focus({ preventScroll: true });
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
      const time = getComputedStyle(element).getPropertyValue('--motion-exit-duration').trim();
      timer = window.setTimeout(finish, exitDelay(time) + 80);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!element.open || !(event.target instanceof Node) || !element.contains(event.target)) return;
      if (event.key === 'Escape' || leaving) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape' && !event.repeat) close();
      }
    };
    control.current = { close, finish };
    try {
      if (!element.open) element.showModal();
      closeButton.current?.focus({ preventScroll: true });
    } catch (error) {
      console.warn('[image-viewer] Unable to open the image dialog', error);
      finish();
    }
    window.addEventListener('keydown', keydown, true);
    return () => {
      live = false;
      control.current = null;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', keydown, true);
      if (element.open) element.close();
      restoreOpener(previous, element);
    };
  }, []);
  return { dialog, closeButton, closing,
    close: useCallback(() => control.current?.close(), []),
    finish: useCallback(() => control.current?.finish(), []) };
}

function exitDelay(value: string): number {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number < 0) return 150;
  return Math.min(1_000, value.endsWith('ms') ? number : number * 1_000);
}

function restoreOpener(previous: Element | null, dialog: HTMLDialogElement) {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && !dialog.contains(active)) return;
  if (previous instanceof HTMLElement && previous.isConnected
    && !previous.closest('[hidden], [inert], details:not([open])')
    && previous.getClientRects().length && getComputedStyle(previous).visibility === 'visible') {
    previous.focus({ preventScroll: true });
  }
}
