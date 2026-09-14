import { useEffect, useState } from 'react';
import { formatStreamStatus, type StreamPhase } from './stream-status';
import { useLocale } from '../../i18n/LocaleContext';

/** Display interpolation only; heartbeat remains the authoritative stage sample. */
export default function LivePhase({ phase, elapsed = 0, tool, argumentChars, notice }: {
  phase: StreamPhase; elapsed?: number; tool?: string; argumentChars?: number; notice?: string;
}) {
  const { locale } = useLocale();
  const [seconds, setSeconds] = useState(elapsed);
  useEffect(() => {
    setSeconds(elapsed);
    if (phase === 'model-output') return;
    const started = performance.now();
    const timer = setInterval(() => setSeconds(elapsed + Math.floor((performance.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase, elapsed, tool]);
  return <div className="chat__streaming-phase">{notice || formatStreamStatus(phase, seconds, tool, argumentChars, locale)}</div>;
}
