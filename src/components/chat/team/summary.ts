import type { TeamSnapshot } from './types';
export function summarizeTeam(data: TeamSnapshot | null) {
  return {
    running: data?.members.filter(member => member.run?.status === 'running').length ?? 0,
    pending: data?.reports.filter(report => !report.acknowledged).length ?? 0,
    members: data?.members.filter(member => member.lifecycle === 'active').length ?? 0,
  };
}
