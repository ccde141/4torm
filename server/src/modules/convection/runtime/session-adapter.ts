import { listSessions } from '../infrastructure/session-store.js';
import type {
  ConvectionRoundObservationPort,
  ConvectionRunObservationPort,
  ConvectionRuntimeSource,
} from '../domain/session-snapshot.js';

export function createConvectionRuntimeSource(
  dataDir: string,
  rounds: ConvectionRoundObservationPort,
  runs?: ConvectionRunObservationPort,
): ConvectionRuntimeSource {
  return {
    snapshots: async () => Promise.all((await listSessions(dataDir)).map(async session => ({
      sessionId: session.id, title: session.title, updatedAt: session.updatedAt,
      activeRound: rounds.snapshot(session.id),
      ...(runs ? { lastRound: await runs.latest(session.id) ?? undefined } : {}),
    }))),
  };
}
