import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

export type CycloneJoinBehavior = 'summary' | 'intro' | 'none';

export interface StartRoomIntroductionInput {
  workshopId: string;
  roomId: string;
  intros: Array<{ seatId: string; behavior: CycloneJoinBehavior }>;
}

export interface PreparedCycloneRoomIntroduction {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
}

export interface CycloneRoomIntroductionPort {
  prepare(input: StartRoomIntroductionInput): Promise<PreparedCycloneRoomIntroduction>;
}
