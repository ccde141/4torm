import type { CycloneDispatch, DispatchStatus } from '../pages/dispatch-timeline';
import type { SeatRunnerOutcome } from '../pages/useSeatStreamRunners';
import type { OrganizationSeat } from './organization-types';

interface RunnerSnapshot {
  streaming: boolean;
  outcome?: SeatRunnerOutcome;
  live: { segments: Array<{ blocks: Array<{ kind: string; id?: string; target?: string; status?: string }> }> };
}

const ACTIVE = new Set<DispatchStatus>(['queued', 'running', 'awaiting_human']);

export interface OrganizationRuntime {
  busySeatIds: Set<string>;
  activeDispatchPairs: Set<string>;
  activeContactPairs: Set<string>;
  contactActivities: Array<{ id: string; pair: string; status: string }>;
  seatActivities: Array<{ seatId: string; outcome: SeatRunnerOutcome }>;
}

export function relationPair(sourceSeatId: string, targetSeatId: string): string {
  return `${sourceSeatId}:${targetSeatId}`;
}

export function deriveOrganizationRuntime(
  seats: OrganizationSeat[],
  dispatches: CycloneDispatch[],
  getRunner: (seatId: string) => RunnerSnapshot | undefined,
): OrganizationRuntime {
  const busySeatIds = new Set<string>();
  const activeDispatchPairs = new Set<string>();
  const activeContactPairs = new Set<string>();
  const contactActivities: OrganizationRuntime['contactActivities'] = [];
  const seatActivities: OrganizationRuntime['seatActivities'] = [];
  const seatIdByTitle = new Map(seats.map(seat => [seat.title, seat.id]));
  for (const seat of seats) {
    const runner = getRunner(seat.id);
    if (!runner) continue;
    seatActivities.push({
      seatId: seat.id,
      outcome: runner.outcome ?? (runner.streaming ? 'running' : 'completed'),
    });
    if (!runner.streaming) continue;
    busySeatIds.add(seat.id);
    for (const segment of runner.live.segments) {
      for (const block of segment.blocks) {
        if (block.kind !== 'contact' || !block.target) continue;
        const targetId = seatIdByTitle.get(block.target);
        if (targetId) {
          const pair = relationPair(seat.id, targetId);
          if (block.status === 'running') activeContactPairs.add(pair);
          if (block.id && block.status) contactActivities.push({ id: block.id, pair, status: block.status });
        }
      }
    }
  }
  for (const item of dispatches) {
    if (!ACTIVE.has(item.status)) continue;
    busySeatIds.add(item.targetSeatId);
    activeDispatchPairs.add(relationPair(item.sourceSeatId, item.targetSeatId));
  }
  return { busySeatIds, activeDispatchPairs, activeContactPairs, contactActivities, seatActivities };
}

export function updateSeatCompletionSignals(
  signals: Record<string, number>, previousOutcomes: Map<string, SeatRunnerOutcome>,
  activities: Array<{ seatId: string; outcome: SeatRunnerOutcome }>,
): { signals: Record<string, number>; outcomes: Map<string, SeatRunnerOutcome> } {
  let nextSignals = signals;
  const outcomes = new Map(previousOutcomes);
  for (const activity of activities) {
    const previous = previousOutcomes.get(activity.seatId);
    outcomes.set(activity.seatId, activity.outcome);
    if (previous === 'running' && activity.outcome === 'completed') {
      if (nextSignals === signals) nextSignals = { ...signals };
      nextSignals[activity.seatId] = (nextSignals[activity.seatId] ?? 0) + 1;
    }
  }
  return { signals: nextSignals, outcomes };
}

export function updateContactReturnSignals(
  signals: Record<string, number>, previousStatuses: Map<string, string>,
  activities: Array<{ id: string; pair: string; status: string }>,
): { signals: Record<string, number>; statuses: Map<string, string> } {
  let nextSignals = signals;
  const statuses = new Map<string, string>();
  for (const activity of activities) {
    statuses.set(activity.id, activity.status);
    if (activity.status === 'success' && previousStatuses.get(activity.id) === 'running') {
      if (nextSignals === signals) nextSignals = { ...signals };
      nextSignals[activity.pair] = (nextSignals[activity.pair] ?? 0) + 1;
    }
  }
  return { signals: nextSignals, statuses };
}

export function updateCompletionSignals(
  signals: Record<string, number>,
  previousStatuses: Map<string, DispatchStatus>,
  dispatches: CycloneDispatch[],
): { signals: Record<string, number>; statuses: Map<string, DispatchStatus> } {
  let nextSignals = signals;
  const statuses = new Map<string, DispatchStatus>();
  for (const item of dispatches) {
    statuses.set(item.id, item.status);
    if (item.status === 'completed' && previousStatuses.has(item.id)
      && previousStatuses.get(item.id) !== 'completed') {
      if (nextSignals === signals) nextSignals = { ...signals };
      nextSignals[item.targetSeatId] = (nextSignals[item.targetSeatId] ?? 0) + 1;
    }
  }
  return { signals: nextSignals, statuses };
}
