import { useCallback, useEffect } from 'react';
import type { Locale } from '../../../i18n/locale';
import { useSeatStreamRunners } from './useSeatStreamRunners';
import { SUPERVISOR_STREAM_KEY } from './supervisor-client';

export function useSupervisorStreamRunners(workshopId: string | null, visible: boolean, locale: Locale) {
  const finished = useCallback(() => undefined, []);
  const runners = useSeatStreamRunners(finished, locale, workshopId ?? '');
  useEffect(() => {
    if (visible) runners.foreground(SUPERVISOR_STREAM_KEY);
    else runners.background(SUPERVISOR_STREAM_KEY);
  }, [runners, visible]);
  return runners;
}
