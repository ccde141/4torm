import { useEffect, useState } from 'react';
import { findLatestAgentRecords } from '../../api/collaboration';
import type { AttributedRecord } from './agent-record-view';

const REFRESH_MS = 30_000;
const BATCH_SIZE = 100;

export function useDashboardRecentRecords(active: boolean, agentIds: string[]) {
  const [records, setRecords] = useState<Record<string, AttributedRecord>>({});
  const [failureCount, setFailureCount] = useState(0);
  const ids = [...agentIds].sort().join('\0');
  useEffect(() => {
    if (!active || !ids) return;
    let current = true;
    const batches = batch(ids.split('\0'));
    const load = async () => {
      const outcomes = await Promise.allSettled(batches.map(findLatestAgentRecords));
      if (!current) return;
      const next: Record<string, AttributedRecord> = {};
      let failures = 0;
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') { failures += 1; continue; }
        failures += outcome.value.failures.length;
        for (const item of outcome.value.items) {
          next[item.agentId] = { feature: item.feature, record: item.record };
        }
      }
      setRecords(next);
      setFailureCount(failures);
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { current = false; window.clearInterval(timer); };
  }, [active, ids]);
  return { records, failureCount };
}

function batch(ids: string[]): string[][] {
  const output: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    output.push(ids.slice(offset, offset + BATCH_SIZE));
  }
  return output;
}
