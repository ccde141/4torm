const CONFIRMATION_KEYS = new Set(['Escape', 'Enter', 'Tab']);

/** A native top-layer dialog owns keys from its subtree, ahead of ordinary portal overlays. */
export function confirmationCapturesKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  if (!CONFIRMATION_KEYS.has(event.key)) return false;
  return !(typeof Element !== 'undefined' && event.target instanceof Element
    && event.target.closest('dialog:modal'));
}
