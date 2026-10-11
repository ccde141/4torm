import { useCallback, useEffect, useRef, useState } from 'react';
import { findOperationRecords, type CollaborationFeature } from '../../api/collaboration';
import type { AttributedRecord } from './agent-record-view';

const FEATURES: CollaborationFeature[] =
  ['monsoon', 'convection', 'cyclone', 'tradewind', 'tide'];

export function useAgentRecords(agentId: string) {
  const [records, setRecords] = useState<AttributedRecord[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<CollaborationFeature, string>>>({});
  const [failures, setFailures] = useState<CollaborationFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (
    features: CollaborationFeature[], next: Partial<Record<CollaborationFeature, string>>,
  ) => {
    const token = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled(features.map(feature =>
      findOperationRecords(feature, { agentId, limit: 10,
        ...(next[feature] ? { cursor: next[feature] } : {}) })));
    if (token !== generation.current) return;
    const received: AttributedRecord[] = [];
    const errors: CollaborationFeature[] = [];
    const following: Partial<Record<CollaborationFeature, string>> = { ...next };
    results.forEach((result, index) => {
      const feature = features[index]!;
      if (result.status === 'rejected') { errors.push(feature); return; }
      received.push(...result.value.items.map(record => ({ feature, record })));
      following[feature] = result.value.nextCursor;
    });
    setRecords(previous => [...previous, ...received]);
    setCursors(following);
    setFailures(errors);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    setRecords([]); setCursors({}); setFailures([]);
    void load(FEATURES, {});
    return () => { generation.current++; };
  }, [load]);

  const more = () => {
    if (loading) return;
    const features = FEATURES.filter(feature => !!cursors[feature]);
    if (features.length) void load(features, cursors);
  };
  return { records, failures, loading, hasMore: Object.values(cursors).some(Boolean), more };
}
