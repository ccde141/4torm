import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

export interface StartCycloneChairChatInput {
  workshopId: string;
  roomId: string;
  message: string;
}

export interface PreparedCycloneChairChat {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
  dispose(cause?: unknown): Promise<void>;
}

export interface CycloneChairChatPort {
  prepare(input: StartCycloneChairChatInput): Promise<PreparedCycloneChairChat>;
}
