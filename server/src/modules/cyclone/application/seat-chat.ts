import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

export interface StartCycloneSeatChatInput {
  workshopId: string;
  seatId: string;
  mode: 'chat' | 'resume';
  text: string;
}

export interface PreparedCycloneSeatChat {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
}

export interface CycloneSeatChatPort {
  prepare(input: StartCycloneSeatChatInput): Promise<PreparedCycloneSeatChat>;
}
