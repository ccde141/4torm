import { randomUUID } from 'node:crypto';

export interface TeamActivityEvent {
  type: 'team-activity';
  id: string;
  stage: 'dispatched' | 'reported' | 'injected' | 'acknowledged' | 'reviewed';
  timestamp: string;
  memberId: string;
  memberName?: string;
  runId?: string;
  reportId?: string;
  outcome?: string;
  decision?: string;
  preview?: string;
}

export function teamActivity(
  stage: TeamActivityEvent['stage'],
  fact: Omit<TeamActivityEvent, 'type' | 'id' | 'stage' | 'timestamp'>,
): TeamActivityEvent {
  return { ...fact, preview: fact.preview?.slice(0, 240), type: 'team-activity',
    id: randomUUID(), stage, timestamp: new Date().toISOString() };
}
