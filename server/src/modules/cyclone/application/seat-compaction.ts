import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

export interface StartCycloneSeatCompactionInput {
  workshopId: string;
  seatId: string;
}

export interface PreparedCycloneSeatCompaction {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
}

export interface CycloneSeatCompactionPort {
  prepare(input: StartCycloneSeatCompactionInput): Promise<PreparedCycloneSeatCompaction>;
}
