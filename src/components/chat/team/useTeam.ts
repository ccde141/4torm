import { useEffect, useState } from 'react';
import type { TeamSnapshot } from './types';

/** One request at a time; no idle polling, no retries hidden behind an error. */
export function useTeam(agentId: string, sessionId: string, mainBusy: boolean) {
  const [data, setData] = useState<TeamSnapshot | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const query = new URLSearchParams({ agentId, sessionId });
        const response = await fetch(`/api/conversation/team?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        const snapshot: TeamSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setData(snapshot); setError('');
        if (mainBusy || snapshot.members.some(member => member.run?.status === 'running')) {
          timer = setTimeout(read, 1500);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [agentId, sessionId, mainBusy, refresh]);
  return { data, error, reload: () => setRefresh(value => value + 1) };
}
