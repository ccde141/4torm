import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { useLocale } from '../../../i18n/LocaleContext';
import { createLatestRequestGuard, type LatestRequest } from '../../../lib/latest-request';
import BulletinBoard, { type BulletinEntry } from '../pages/BulletinBoard';
import { subscribeCycloneChanges } from '../pages/cyclone-change-client';
import type { CycloneDispatch } from '../pages/dispatch-timeline';
import type { SeatRunnerOutcome, SeatStreamRunners } from '../pages/useSeatStreamRunners';
import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import { loadOrganization, saveOrganization } from './organization-client';
import { createEditableOrganization, rebaseEditableOrganization } from './organization-model';
import { deriveOrganizationRuntime, updateCompletionSignals, updateContactReturnSignals, updateSeatCompletionSignals } from './organization-runtime';
import type { EditableOrganization, OrganizationSeat, WorkshopOrganizationState } from './organization-types';
import { CycloneOrganizationCanvas } from './CycloneOrganizationCanvas';
import type { Agent } from '../../../types';
import { deriveOrganizationSaveState } from './organization-save-state';
import { mergeActivityPairs, mergeExternalRunningSeatStatuses } from './organization-external-status';
import { useOrganizationExternalActivity } from './useOrganizationExternalActivity';
import { useOrganizationSeatReconciliation } from './useOrganizationSeatReconciliation';

interface Props {
  workshopId: string;
  summaryReady: boolean;
  agents: Agent[];
  title?: string;
  seats: OrganizationSeat[];
  bulletin: BulletinEntry[];
  dispatches: CycloneDispatch[];
  runners: SeatStreamRunners;
  seatStatuses: Map<string, WorkspaceEntityStatus>;
  panel: 'graph' | 'bulletin';
  active: boolean;
  onBulletinSaved(entries: BulletinEntry[]): void;
  onRenamed(): void;
  onOpenSeat(seatId: string): void;
}

interface PendingOrganizationState {
  workshopId: string;
  state: WorkshopOrganizationState;
  request: LatestRequest;
}

export function OrganizationWorkspace(props: Props) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<EditableOrganization | null>(null);
  const [savedDraft, setSavedDraft] = useState<EditableOrganization | null>(null);
  const [pendingOrganizationState, setPendingOrganizationState] = useState<PendingOrganizationState | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [runtimeTick, forceRuntimeTick] = useState(0);
  const [completedSignals, setCompletedSignals] = useState<Record<string, number>>({});
  const [contactReturnSignals, setContactReturnSignals] = useState<Record<string, number>>({});
  const requestGuard = useRef(createLatestRequestGuard());
  const selectedWorkshopRef = useRef(props.workshopId);
  const savedDraftRef = useRef(savedDraft);
  const savingRef = useRef(saving);
  const deferredChangeRef = useRef(false);
  const subscribedWorkshopRef = useRef<string | null>(null);
  const tRef = useRef(t);
  selectedWorkshopRef.current = props.workshopId;
  savedDraftRef.current = savedDraft;
  savingRef.current = saving;
  tRef.current = t;
  const statusesRef = useRef(new Map<string, CycloneDispatch['status']>());
  const contactStatusesRef = useRef(new Map<string, string>());
  const seatOutcomesRef = useRef(new Map<string, SeatRunnerOutcome>());
  const returnTimersRef = useRef(new Map<string, number>());
  const reconcilingSeats = useOrganizationSeatReconciliation({
    workshopId: props.workshopId, seats: props.seats, draft, savedDraft,
    loadFailedMessage: t('cyclone.org.loadFailed'), setDraft, setSavedDraft, setError,
  });
  const externalActivity = useOrganizationExternalActivity(props.workshopId, props.active && props.panel === 'graph');
  const visibleSeatStatuses = useMemo(
    () => mergeExternalRunningSeatStatuses(props.seatStatuses, externalActivity.runningSeatIds),
    [externalActivity.runningSeatIds, props.seatStatuses],
  );

  const reload = useCallback(async (signal?: AbortSignal) => {
    const workshopId = props.workshopId;
    const request = requestGuard.current.begin();
    try {
      const state = await loadOrganization(workshopId, signal);
      if (!request.isCurrent() || selectedWorkshopRef.current !== workshopId) return;
      if (savedDraftRef.current
        && state.organization?.revision === savedDraftRef.current.baseRevision) return;
      setPendingOrganizationState({ workshopId, state, request });
    } catch (cause) {
      if (request.isCurrent() && selectedWorkshopRef.current === workshopId
        && (cause as Error).name !== 'AbortError') {
        setError((cause as Error).message || tRef.current('cyclone.org.loadFailed'));
      }
    }
  }, [props.workshopId]);

  useEffect(() => {
    const controller = new AbortController();
    const guard = requestGuard.current;
    guard.cancel();
    savedDraftRef.current = null;
    savingRef.current = false;
    setDraft(null); setSavedDraft(null); setPendingOrganizationState(null);
    setSaving(false); setError('');
    void reload(controller.signal);
    return () => { controller.abort(); guard.cancel(); };
  }, [reload]);

  useEffect(() => {
    if (!props.summaryReady || !pendingOrganizationState
      || pendingOrganizationState.workshopId !== props.workshopId
      || !pendingOrganizationState.request.isCurrent()) return;
    const authoritative = createEditableOrganization(pendingOrganizationState.state, props.seats);
    const previousSaved = savedDraftRef.current;
    savedDraftRef.current = authoritative;
    setDraft(current => !current || current === previousSaved ? authoritative : current);
    setSavedDraft(authoritative);
    setPendingOrganizationState(null);
  }, [pendingOrganizationState, props.seats, props.summaryReady, props.workshopId]);

  useEffect(() => {
    if (!props.active || props.panel !== 'graph') return;
    const guard = requestGuard.current;
    if (subscribedWorkshopRef.current === props.workshopId) void reload();
    subscribedWorkshopRef.current = props.workshopId;
    const unsubscribe = subscribeCycloneChanges(event => {
      const relevant = event.type === 'sync' || (event.type === 'change'
        && event.workshopId === props.workshopId && event.scope === 'workshop');
      if (!relevant) return;
      if (savingRef.current) {
        deferredChangeRef.current = true;
        return;
      }
      void reload();
    });
    return () => { unsubscribe(); guard.cancel(); };
  }, [props.active, props.panel, props.workshopId, reload]);

  useEffect(() => {
    setCompletedSignals({}); setContactReturnSignals({});
    statusesRef.current = new Map(); contactStatusesRef.current = new Map();
    seatOutcomesRef.current = new Map();
    returnTimersRef.current.forEach(timer => window.clearTimeout(timer));
    returnTimersRef.current.clear();
  }, [props.workshopId]);

  useEffect(() => {
    setCompletedSignals(current => {
      const next = updateCompletionSignals(current, statusesRef.current, props.dispatches);
      statusesRef.current = next.statuses;
      return next.signals;
    });
  }, [props.dispatches]);

  useEffect(() => {
    const unsubscribers = props.seats.map(seat => props.runners.subscribe(seat.id, () => forceRuntimeTick(value => value + 1)));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [props.runners, props.seats]);

  const runtime = useMemo(() => {
    void runtimeTick; // runner 缓冲是可变注册表；订阅 tick 明确触发只读投影更新。
    return deriveOrganizationRuntime(props.seats, props.dispatches, props.runners.getRunner);
  }, [props.dispatches, props.runners, props.seats, runtimeTick]);
  const activeContactPairs = useMemo(
    () => mergeActivityPairs(runtime.activeContactPairs, externalActivity.activeContactPairs),
    [externalActivity.activeContactPairs, runtime.activeContactPairs],
  );
  const activeDispatchPairs = useMemo(
    () => mergeActivityPairs(runtime.activeDispatchPairs, externalActivity.activeDispatchPairs),
    [externalActivity.activeDispatchPairs, runtime.activeDispatchPairs],
  );

  useEffect(() => {
    setCompletedSignals(current => {
      const next = updateSeatCompletionSignals(current, seatOutcomesRef.current, runtime.seatActivities);
      seatOutcomesRef.current = next.outcomes;
      return next.signals;
    });
  }, [runtime.seatActivities]);

  useEffect(() => {
    setContactReturnSignals(current => {
      const next = updateContactReturnSignals(current, contactStatusesRef.current, runtime.contactActivities);
      contactStatusesRef.current = next.statuses;
      if (next.signals === current) return current;
      for (const pair of Object.keys(next.signals)) {
        if (next.signals[pair] === current[pair]) continue;
        const previousTimer = returnTimersRef.current.get(pair);
        if (previousTimer) window.clearTimeout(previousTimer);
        const timer = window.setTimeout(() => {
          setContactReturnSignals(signals => {
            const copy = { ...signals }; delete copy[pair]; return copy;
          });
          returnTimersRef.current.delete(pair);
        }, 1_100);
        returnTimersRef.current.set(pair, timer);
      }
      return next.signals;
    });
  }, [runtime.contactActivities]);

  const save = async () => {
    if (!draft || savingRef.current || reconcilingSeats.blocked) return;
    if (draft.activatesExplicitMode && !(await confirm({
      title: t('cyclone.org.activateTitle'), message: t('cyclone.org.activateMessage'),
      confirmText: t('cyclone.org.activate'),
    }))) return;
    if (selectedWorkshopRef.current !== props.workshopId) return;
    const workshopId = props.workshopId;
    const submittedDraft = draft;
    requestGuard.current.cancel();
    setPendingOrganizationState(null);
    deferredChangeRef.current = false;
    savingRef.current = true;
    setSaving(true); setError('');
    let succeeded = false;
    try {
      const saved = await saveOrganization(workshopId, submittedDraft);
      if (selectedWorkshopRef.current !== workshopId) return;
      const savedState = createEditableOrganization({ mode: 'explicit', organization: saved }, props.seats);
      savedDraftRef.current = savedState;
      setDraft(current => current === submittedDraft ? savedState
        : current ? rebaseEditableOrganization(current, { mode: 'explicit', organization: saved }, props.seats) : current);
      setSavedDraft(savedState);
      succeeded = true;
    } catch (cause) {
      if (selectedWorkshopRef.current === workshopId) {
        setError((cause as Error).message || t('cyclone.org.saveFailed'));
      }
    } finally {
      if (selectedWorkshopRef.current === workshopId) {
        savingRef.current = false;
        setSaving(false);
        if (!succeeded || deferredChangeRef.current) void reload();
      }
    }
  };

  const saveState = draft && savedDraft
    ? deriveOrganizationSaveState(draft, savedDraft, saving || reconcilingSeats.blocked)
    : 'saved';
  return <section className="cyclone-org-workspace">
    {props.panel === 'bulletin' ? <BulletinBoard workshopId={props.workshopId} title={props.title}
      entries={props.bulletin} onSaved={props.onBulletinSaved} onRenamed={props.onRenamed} />
      : draft ? <CycloneOrganizationCanvas draft={draft} seats={props.seats} agents={props.agents}
        seatStatuses={visibleSeatStatuses} completedSignals={completedSignals}
        activeContactPairs={activeContactPairs} activeDispatchPairs={activeDispatchPairs}
        contactReturnSignals={contactReturnSignals}
        saving={saving || reconcilingSeats.blocked} saveState={saveState} error={error}
        onRetrySync={reconcilingSeats.failed ? reconcilingSeats.retry : undefined}
        onChange={setDraft} onSave={() => void save()}
        onOpenSeat={props.onOpenSeat} onError={setError} />
        : <div className="cyclone-org-workspace__loading">{error || t('cyclone.org.loading')}</div>}
  </section>;
}
