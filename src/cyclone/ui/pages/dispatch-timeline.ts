export type DispatchStatus = 'queued' | 'running' | 'awaiting_human' | 'completed' | 'failed';
export type DispatchDecisionState = 'pending' | 'included' | 'dismissed' | 'expired' | 'not_applicable';
export type DispatchActivityPhase = 'waiting-agent' | 'llm-waiting' | 'model-output' | 'tool-preparing' | 'tool-exec';

export interface DispatchActivity {
  phase: DispatchActivityPhase;
  tool?: string;
  target?: string;
  elapsedSeconds?: number;
  argumentChars?: number;
}

export interface CycloneDispatch {
  id: string;
  workshopId: string;
  sourceKind?: 'room' | 'seat';
  sourceRoomId: string;
  sourceSeatId: string;
  sourceSeatTitle: string;
  sourceTurnId: string;
  sourceRoundSeq: number;
  contextVersion?: number;
  dispatchOrder: number;
  targetSeatId: string;
  targetSeatTitle: string;
  task: string;
  status: DispatchStatus;
  activity?: DispatchActivity;
  readState: 'unread' | 'read';
  decisionState: DispatchDecisionState;
  receiptState?: 'pending' | 'delivered';
  response?: string;
  error?: string;
  completedAt?: string;
  decisionDeadlineRoundSeq?: number;
  includedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineMessage {
  key: string;
  turnId?: string;
}

export type DispatchTimelineItem<T extends TimelineMessage> =
  | { kind: 'message'; message: T }
  | { kind: 'dispatch'; dispatch: CycloneDispatch };

export function buildDispatchTimeline<T extends TimelineMessage>(
  messages: T[],
  dispatches: CycloneDispatch[],
): DispatchTimelineItem<T>[] {
  const byTurn = new Map<string, CycloneDispatch[]>();
  for (const item of dispatches) {
    const group = byTurn.get(item.sourceTurnId) ?? [];
    group.push(item);
    byTurn.set(item.sourceTurnId, group);
  }
  for (const group of byTurn.values()) group.sort((a, b) => a.dispatchOrder - b.dispatchOrder);

  const used = new Set<string>();
  const timeline: DispatchTimelineItem<T>[] = [];
  for (const message of messages) {
    timeline.push({ kind: 'message', message });
    if (!message.turnId) continue;
    for (const item of byTurn.get(message.turnId) ?? []) {
      timeline.push({ kind: 'dispatch', dispatch: item });
      used.add(item.id);
    }
  }
  for (const item of dispatches) {
    if (!used.has(item.id)) timeline.push({ kind: 'dispatch', dispatch: item });
  }
  return timeline;
}

export function countPendingDispatches(dispatches: CycloneDispatch[]): number {
  return dispatches.filter(item => (
    item.decisionState === 'pending'
    && (item.status === 'completed' || item.status === 'failed')
  )).length;
}

export function selectVisibleSeatDispatches(
  dispatches: CycloneDispatch[],
  seatId: string,
): CycloneDispatch[] {
  return dispatches.filter(item => (
    item.sourceKind === 'seat'
    && item.sourceSeatId === seatId
    && item.receiptState !== 'delivered'
  ));
}
