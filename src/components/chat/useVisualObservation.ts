import { useEffect, useRef, useState } from 'react';
import {
  isActiveObservationStatus,
  readVisualObservation,
  requestVisualObservationRefresh,
  setVisualObservationControl,
  visualObservationFrameUrl,
  type VisualObservationControl,
  type VisualObservationDetail,
  type VisualObservationOwner,
} from './visual-observation-client';

const POLL_MS = 750;
const INITIAL_RETRY_MS = 250;
const MAX_READ_FAILURES = 3;

interface UseVisualObservationInput extends VisualObservationOwner {
  observationId: string;
  refreshActiveObservation?: boolean;
}

export function useVisualObservation(input: UseVisualObservationInput) {
  const { scope, ownerId, observationId, refreshActiveObservation = false } = input;
  const [loaded, setLoaded] = useState<{ requestKey: string; item: VisualObservationDetail; observedAt: number } | null>(null);
  const [failure, setFailure] = useState<{ requestKey: string; message: string } | null>(null);
  const requestKey = `${scope}\u0000${ownerId}\u0000${observationId}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const owner = { scope, ownerId };
    let timer: number | undefined;
    let failures = 0;

    // A key check is still required after abort: a response may already have resolved
    // when React switches owner or tab, and must never publish into the new surface.
    const isCurrent = () => !controller.signal.aborted && requestKeyRef.current === requestKey;
    const schedule = (load: () => Promise<void>, delay: number) => {
      timer = window.setTimeout(() => void load(), delay);
    };
    const load = async (): Promise<void> => {
      try {
        const next = await readVisualObservation(observationId, owner, controller.signal);
        if (!isCurrent()) return;
        failures = 0;
        setLoaded({ requestKey, item: next, observedAt: Date.now() });
        setFailure(null);
        if (!isActiveObservationStatus(next.status)) return;
        if (refreshActiveObservation) {
          // Refresh is only a wake-up hint for native drivers; the next GET remains
          // the authoritative observation and a transient refresh miss is not fatal.
          void requestVisualObservationRefresh(observationId, owner, controller.signal).catch(() => undefined);
        }
        schedule(load, POLL_MS);
      } catch (cause) {
        if (!isCurrent()) return;
        failures += 1;
        if (failures >= MAX_READ_FAILURES) {
          setFailure({ requestKey, message: (cause as Error).message || 'Unable to read execution surface' });
          return;
        }
        schedule(load, INITIAL_RETRY_MS);
      }
    };

    setLoaded(null);
    setFailure(null);
    void load();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [scope, ownerId, observationId, refreshActiveObservation, requestKey]);

  const currentItem = loaded?.requestKey === requestKey ? loaded.item : null;
  const error = failure?.requestKey === requestKey ? failure.message : '';
  const owner = { scope, ownerId };
  const control = async (next: VisualObservationControl): Promise<boolean> => {
    const keyAtStart = requestKey;
    try {
      await setVisualObservationControl(observationId, owner, next);
      if (requestKeyRef.current !== keyAtStart) return false;
      setLoaded(current => current?.requestKey === keyAtStart && current.item.viewerState
        ? { ...current, item: { ...current.item, viewerState: { ...current.item.viewerState, control: next } } }
        : current);
      setFailure(null);
      return true;
    } catch (cause) {
      if (requestKeyRef.current === keyAtStart) {
        setFailure({ requestKey: keyAtStart, message: (cause as Error).message || 'Control transfer failed' });
      }
      return false;
    }
  };

  return {
    item: currentItem,
    observedAt: loaded?.requestKey === requestKey ? loaded.observedAt : 0,
    error,
    control,
    frameUrl: visualObservationFrameUrl(observationId, owner, currentItem?.viewerState?.revision ?? 0),
  };
}
