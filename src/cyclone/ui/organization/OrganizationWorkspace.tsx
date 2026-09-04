import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { useLocale } from '../../../i18n/LocaleContext';
import BulletinBoard, { type BulletinEntry } from '../pages/BulletinBoard';
import type { CycloneDispatch } from '../pages/dispatch-timeline';
import type { SeatRunnerOutcome, SeatStreamRunners } from '../pages/useSeatStreamRunners';
import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import { loadOrganization, saveOrganization } from './organization-client';
import { createEditableOrganization } from './organization-model';
import { deriveOrganizationRuntime, updateCompletionSignals, updateContactReturnSignals, updateSeatCompletionSignals } from './organization-runtime';
import type { EditableOrganization, OrganizationSeat } from './organization-types';
import { CycloneOrganizationCanvas } from './CycloneOrganizationCanvas';
import type { Agent } from '../../../types';
import { deriveOrganizationSaveState } from './organization-save-state';
import { mergeActivityPairs, mergeExternalRunningSeatStatuses } from './organization-external-status';
import { useOrganizationExternalActivity } from './useOrganizationExternalActivity';
import { useOrganizationSeatReconciliation } from './useOrganizationSeatReconciliation';

interface Props {
  workshopId: string;
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

export function OrganizationWorkspace(props: Props) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<EditableOrganization | null>(null);
  const [savedDraft, setSavedDraft] = useState<EditableOrganization | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [runtimeTick, forceRuntimeTick] = useState(0);
  const [completedSignals, setCompletedSignals] = useState<Record<string, number>>({});
  const [contactReturnSignals, setContactReturnSignals] = useState<Record<string, number>>({});
  const statusesRef = useRef(new Map<string, CycloneDispatch['status']>());
  const contactStatusesRef = useRef(new Map<string, string>());
  const seatOutcomesRef = useRef(new Map<string, SeatRunnerOutcome>());
  const returnTimersRef = useRef(new Map<string, number>());
  const seatsRef = useRef(props.seats);
  seatsRef.current = props.seats;
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
    setError('');
    try {
      const state = await loadOrganization(props.workshopId, signal);
      const loadedDraft = createEditableOrganization(state, seatsRef.current);
      setDraft(loadedDraft); setSavedDraft(loadedDraft);
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError((cause as Error).message || t('cyclone.org.loadFailed'));
    }
  }, [props.workshopId, t]);

  useEffect(() => {
    const controller = new AbortController();
    setDraft(null); setSavedDraft(null);
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

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
    if (!draft || saving || reconcilingSeats.blocked) return;
    if (draft.activatesExplicitMode && !(await confirm({
      title: t('cyclone.org.activateTitle'), message: t('cyclone.org.activateMessage'),
      confirmText: t('cyclone.org.activate'),
    }))) return;
    setSaving(true); setError('');
    try {
      const saved = await saveOrganization(props.workshopId, draft);
      const savedState = createEditableOrganization({ mode: 'explicit', organization: saved }, props.seats);
      setDraft(savedState); setSavedDraft(savedState);
    } catch (cause) { setError((cause as Error).message || t('cyclone.org.saveFailed')); }
    finally { setSaving(false); }
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
