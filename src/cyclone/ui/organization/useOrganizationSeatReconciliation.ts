import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { loadOrganization } from './organization-client';
import {
  createEditableOrganization,
  rebaseEditableOrganization,
  reconcileOrganizationSeats,
} from './organization-model';
import type { EditableOrganization, OrganizationSeat, WorkshopOrganizationState } from './organization-types';

type DraftSetter = Dispatch<SetStateAction<EditableOrganization | null>>;

interface LoadOptions {
  workshopId: string;
  seats: OrganizationSeat[];
  loadFailedMessage: string;
  setDraft: DraftSetter;
  setSavedDraft: DraftSetter;
  setError(message: string): void;
}

interface Options extends LoadOptions {
  draft: EditableOrganization | null;
  savedDraft: EditableOrganization | null;
}

export interface OrganizationSeatReconciliation {
  blocked: boolean;
  failed: boolean;
  retry(): void;
}

function useReconciliationRuntime(
  workshopId: string,
  seats: OrganizationSeat[],
  draft: EditableOrganization | null,
  savedDraft: EditableOrganization | null,
) {
  const [reconciling, setReconciling] = useState(false);
  const [reconcileFailed, setReconcileFailed] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const draftsRef = useRef({ draft, savedDraft });
  const seatsRef = useRef(seats);
  const pendingRebaseRef = useRef(false);
  const observedRef = useRef({ workshopId, seatIds: new Set(seats.map(seat => seat.id)) });
  draftsRef.current = { draft, savedDraft };
  seatsRef.current = seats;
  return {
    reconciling, setReconciling, reconcileFailed, setReconcileFailed,
    retryAttempt, setRetryAttempt, draftsRef, seatsRef, pendingRebaseRef, observedRef,
    seatIdsKey: JSON.stringify(seats.map(seat => seat.id).sort()),
  };
}

function resolveRebasedDraft(
  current: EditableOrganization | null,
  before: { draft: EditableOrganization | null; savedDraft: EditableOrganization | null },
  reconciledBefore: EditableOrganization | null,
  authoritative: EditableOrganization,
  state: WorkshopOrganizationState,
  seats: OrganizationSeat[],
): EditableOrganization {
  if (!current) return authoritative;
  const remainedSaved = (current === before.draft || current === reconciledBefore)
    && before.draft === before.savedDraft
    && !current.activatesExplicitMode;
  return remainedSaved ? authoritative : rebaseEditableOrganization(current, state, seats);
}

async function loadAfterSeatRemoval(
  options: LoadOptions,
  before: { draft: EditableOrganization | null; savedDraft: EditableOrganization | null },
  reconciledBefore: EditableOrganization | null,
  controller: AbortController,
  onSettled: (succeeded: boolean) => void,
): Promise<void> {
  try {
    const state = await loadOrganization(options.workshopId, controller.signal);
    const authoritative = createEditableOrganization(state, options.seats);
    options.setSavedDraft(authoritative);
    options.setDraft(current => resolveRebasedDraft(
      current, before, reconciledBefore, authoritative, state, options.seats,
    ));
    onSettled(true);
  } catch (cause) {
    if ((cause as Error).name !== 'AbortError') {
      options.setError((cause as Error).message || options.loadFailedMessage);
      onSettled(false);
    }
  }
}

export function useOrganizationSeatReconciliation(options: Options): OrganizationSeatReconciliation {
  const {
    workshopId, seats, draft, savedDraft, loadFailedMessage,
    setDraft, setSavedDraft, setError,
  } = options;
  const runtime = useReconciliationRuntime(workshopId, seats, draft, savedDraft);
  const {
    reconciling, setReconciling, reconcileFailed, setReconcileFailed,
    retryAttempt, setRetryAttempt, draftsRef, seatsRef, pendingRebaseRef, observedRef, seatIdsKey,
  } = runtime;
  useEffect(() => {
    const currentSeats = seatsRef.current;
    const nextSeatIds = new Set(currentSeats.map(seat => seat.id));
    const previous = observedRef.current;
    observedRef.current = { workshopId, seatIds: nextSeatIds };
    if (previous.workshopId !== workshopId) {
      pendingRebaseRef.current = false;
      setReconciling(false);
      setReconcileFailed(false);
      return;
    }
    const removedSeatIds = [...previous.seatIds].filter(seatId => !nextSeatIds.has(seatId));
    if (removedSeatIds.length > 0) pendingRebaseRef.current = true;
    setDraft(current => current ? reconcileOrganizationSeats(current, currentSeats) : current);
    if (!pendingRebaseRef.current) {
      setReconciling(false);
      setReconcileFailed(false);
      return;
    }
    const controller = new AbortController();
    const before = draftsRef.current;
    const reconciledBefore = before.draft
      ? reconcileOrganizationSeats(before.draft, currentSeats)
      : null;
    setError('');
    setReconciling(true);
    setReconcileFailed(false);
    setDraft(current => current === before.draft
      ? reconciledBefore
      : current ? reconcileOrganizationSeats(current, currentSeats) : current);
    void loadAfterSeatRemoval({
      workshopId, seats: currentSeats, loadFailedMessage, setDraft, setSavedDraft, setError,
    }, before, reconciledBefore, controller, succeeded => {
      if (controller.signal.aborted) return;
      pendingRebaseRef.current = !succeeded;
      setReconciling(false);
      setReconcileFailed(!succeeded);
    });
    return () => controller.abort();
  }, [
    draftsRef, loadFailedMessage, observedRef, pendingRebaseRef, retryAttempt, seatIdsKey,
    seatsRef, setDraft, setError, setReconcileFailed, setReconciling, setSavedDraft, workshopId,
  ]);
  const retry = useCallback(() => {
    if (pendingRebaseRef.current) setRetryAttempt(value => value + 1);
  }, [pendingRebaseRef, setRetryAttempt]);
  return { blocked: reconciling || reconcileFailed, failed: reconcileFailed, retry };
}
