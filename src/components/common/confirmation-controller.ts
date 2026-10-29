export interface ConfirmationState<T> {
  id: number;
  options: T;
  closing: boolean;
}

type Schedule = (callback: () => void) => () => void;

/** Own one unresolved confirmation; an old exit timer must never close a new one. */
export function createConfirmationController<T>(
  publish: (state: ConfirmationState<T> | null) => void,
  schedule: Schedule = callback => {
    const timer = setTimeout(callback, 160);
    return () => clearTimeout(timer);
  },
) {
  let sequence = 0;
  let enabled = true;
  let current: (ConfirmationState<T> & { resolve(value: boolean): void }) | null = null;
  let cancelExit: (() => void) | undefined;

  return {
    activate() {
      enabled = true;
      if (!current) publish(null);
    },
    request(options: T): Promise<boolean> {
      if (!enabled || (current && !current.closing)) return Promise.resolve(false);
      cancelExit?.();
      cancelExit = undefined;
      return new Promise(resolve => {
        current = { id: ++sequence, options, closing: false, resolve };
        publish(current);
      });
    },
    settle(value: boolean): void {
      const request = current;
      if (!request || request.closing) return;
      current = { ...request, closing: true };
      publish(current);
      cancelExit = schedule(() => {
        if (current?.id !== request.id) return;
        current = null;
        cancelExit = undefined;
        publish(null);
      });
      request.resolve(value);
    },
    dispose(): void {
      enabled = false;
      cancelExit?.();
      cancelExit = undefined;
      const request = current;
      current = null;
      if (request && !request.closing) request.resolve(false);
    },
  };
}
