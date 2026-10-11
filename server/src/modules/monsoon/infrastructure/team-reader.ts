import { TeamStore } from '../../../engine/conversation/team/store.js';
import type { MonsoonTeamStateReader } from '../application/team-query.js';

export class FileMonsoonTeamReader implements MonsoonTeamStateReader {
  constructor(private readonly dataDir: string) {}

  recover(agentId: string, sessionId: string) {
    return this.store(agentId, sessionId).recoverInterrupted();
  }

  read(agentId: string, sessionId: string) {
    return this.store(agentId, sessionId).read();
  }

  private store(agentId: string, sessionId: string): TeamStore {
    return new TeamStore(this.dataDir, { agentId, sessionId });
  }
}
