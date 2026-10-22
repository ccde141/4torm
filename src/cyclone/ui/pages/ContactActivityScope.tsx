import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { watchContactActivity } from './contact-activity-client';
import type { ContactResultDisplay } from './contact-result';

const ContactScope = createContext<{ workshopId: string; targetId: string; active: boolean } | null>(null);

export function ContactActivityScope({ workshopId, targetId, active, children }: {
  workshopId: string; targetId: string; active: boolean; children: ReactNode;
}) {
  return <ContactScope value={{ workshopId, targetId, active }}>{children}</ContactScope>;
}

/** Overlay ticket changes without mutating stored history or an in-flight runner. */
export function useContactActivity(results: ContactResultDisplay[]) {
  const scope = useContext(ContactScope);
  const scopeKey = scope ? `${scope.workshopId}:${scope.targetId}` : '';
  const pendingIds = [...new Set(results.filter(result => result.status === 'running')
    .flatMap(result => result.communicationId ? [result.communicationId] : []))].sort().join('\0');
  const [snapshot, setSnapshot] = useState<{ scope: string; entries: Record<string, ContactResultDisplay>; error?: string }>(
    { scope: '', entries: {} });
  const workshopId = scope?.workshopId;
  const active = scope?.active;
  useEffect(() => {
    if (!workshopId || !active || !pendingIds) return;
    return watchContactActivity(workshopId, pendingIds.split('\0'), (id, result) => {
      setSnapshot(previous => ({ scope: scopeKey,
        entries: { ...(previous.scope === scopeKey ? previous.entries : {}), [id]: result } }));
    }, error => setSnapshot(previous => ({ scope: scopeKey,
      entries: previous.scope === scopeKey ? previous.entries : {}, error: error.message })));
  }, [workshopId, scopeKey, active, pendingIds]);
  const entries = snapshot.scope === scopeKey ? snapshot.entries : {};
  return { resolve: (result: ContactResultDisplay) => result.communicationId
    ? entries[result.communicationId] ?? result : result,
  error: snapshot.scope === scopeKey ? snapshot.error : undefined };
}
