export const AGENTS_CHANGED_EVENT = '4torm:agents-changed';

export function notifyAgentsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AGENTS_CHANGED_EVENT));
  }
}
