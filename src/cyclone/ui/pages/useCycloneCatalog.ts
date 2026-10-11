import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import { createLatestRequestGuard } from '../../../lib/latest-request';
import { getAgents } from '../../../store/agent';
import type { Agent } from '../../../types';
import { readCycloneError, type WorkshopSummary } from './cyclone-page-model';
import { subscribeCycloneChanges } from './cyclone-change-client';

/** Keeps the already-open Cyclone page in sync with workshops created elsewhere. */
export function useCycloneCatalog(active?: boolean) {
  const { t } = useLocale();
  const tRef = useRef(t); tRef.current = t;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [workshopsLoaded, setWorkshopsLoaded] = useState(false);
  const listGuard = useRef(createLatestRequestGuard());
  const refreshAgents = useCallback(async () => {
    try { setAgents(await getAgents()); }
    catch (error) { console.error(`[cyclone] ${tRef.current('cyclone.shell.loadAgentsFailed')}`, error); }
  }, []);
  const refreshWorkshops = useCallback(async () => {
    const request = listGuard.current.begin();
    try {
      const response = await fetch('/api/cyclone/list');
      if (response.ok) {
        const items: WorkshopSummary[] = await response.json();
        if (request.isCurrent()) { setWorkshops(items); setWorkshopsLoaded(true); }
      } else if (request.isCurrent()) {
        console.error(await readCycloneError(response, tRef.current('cyclone.shell.loadListFailed')));
      }
    } catch (error) {
      if (request.isCurrent()) console.error(`[cyclone] ${tRef.current('cyclone.shell.loadListFailed')}`, error);
    }
  }, []);
  useEffect(() => {
    const guard = listGuard.current;
    if (!active) { guard.cancel(); return; }
    void refreshAgents();
    let stopped = false;
    let timer: number | undefined;
    const fallback = async () => {
      await refreshWorkshops();
      if (!stopped) timer = window.setTimeout(fallback, 2_000);
    };
    void fallback();
    const refresh = () => { void refreshWorkshops(); };
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change' && event.scope === 'workshop')) refresh();
    });
    window.addEventListener('focus', refresh);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', refresh);
      guard.cancel();
    };
  }, [active, refreshAgents, refreshWorkshops]);
  return { agents, workshops, workshopsLoaded, refreshWorkshops };
}
