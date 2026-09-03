import { useCallback, useEffect, useRef, useState } from 'react';

export function useActiveCapabilityList<T>(active: boolean, loader: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;

    const requestGeneration = ++generation.current;
    const request = loader()
      .then(nextItems => {
        if (requestGeneration !== generation.current) return;
        setItems(nextItems);
        setLoadError(null);
      })
      .catch(error => {
        if (requestGeneration === generation.current) {
          setLoadError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      })
      .finally(() => {
        if (inFlight.current === request) inFlight.current = null;
      });

    inFlight.current = request;
    return request;
  }, [loader]);

  useEffect(() => {
    if (!active) return;

    const observe = () => { void refresh().catch(() => undefined); };
    observe();
    window.addEventListener('focus', observe);

    return () => {
      generation.current += 1;
      inFlight.current = null;
      window.removeEventListener('focus', observe);
    };
  }, [active, refresh]);

  return { items, loadError, refresh };
}
