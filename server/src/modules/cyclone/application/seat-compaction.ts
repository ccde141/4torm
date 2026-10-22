import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

export interface StartCycloneSeatCompactionInput {
  workshopId: string;
  seatId: string;
}

export interface PreparedCycloneSeatCompaction {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
  /** Release an unclaimed preparation; an already claimed run owns its existing terminal commit. */
  dispose(cause?: unknown): Promise<void>;
}

export interface CycloneSeatCompactionPort {
  prepare(input: StartCycloneSeatCompactionInput): Promise<PreparedCycloneSeatCompaction>;
}
