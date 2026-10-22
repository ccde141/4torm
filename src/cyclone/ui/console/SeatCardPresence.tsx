import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConsoleSeat } from './workshop-console-model';
import './seat-card-presence.css';

type CardPhase = 'entering' | 'present' | 'leaving';
interface CardEntry { seat: ConsoleSeat; phase: CardPhase }
interface CardTimer { phase: CardPhase; id: number }

function reconcileCards(previous: CardEntry[], seats: ConsoleSeat[]): CardEntry[] {
  const existing = new Map(previous.map(entry => [entry.seat.id, entry]));
  const visibleIds = new Set(seats.map(seat => seat.id));
  const next = seats.map(seat => {
    const prior = existing.get(seat.id);
    const phase = !prior ? 'entering' : prior.phase === 'leaving' ? 'present' : prior.phase;
    return { seat, phase } as CardEntry;
  });
  // Exiting cards keep their last slot briefly; the source list alone owns membership.
  previous.forEach((entry, index) => {
    if (!visibleIds.has(entry.seat.id)) {
      next.splice(Math.min(index, next.length), 0, { seat: entry.seat, phase: 'leaving' });
    }
  });
  return next;
}

function settleCard(entries: CardEntry[], seatId: string, phase: CardPhase): CardEntry[] {
  return entries.flatMap(entry => {
    if (entry.seat.id !== seatId || entry.phase !== phase) return [entry];
    return phase === 'leaving' ? [] : [{ seat: entry.seat, phase: 'present' as const }];
  });
}

export function SeatCardPresence({ seats, render }: {
  seats: ConsoleSeat[]; render(seat: ConsoleSeat): ReactNode;
}) {
  const [entries, setEntries] = useState<CardEntry[]>(() =>
    seats.map(seat => ({ seat, phase: 'present' })));
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const timers = useRef(new Map<string, CardTimer>());

  useEffect(() => { setEntries(previous => reconcileCards(previous, seats)); }, [seats]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    const activeTimers = timers.current;
    return () => {
      media.removeEventListener('change', update);
      activeTimers.forEach(timer => window.clearTimeout(timer.id));
      activeTimers.clear();
    };
  }, []);

  useEffect(() => {
    const pending = new Map(entries.filter(entry => entry.phase !== 'present')
      .map(entry => [entry.seat.id, entry.phase]));
    timers.current.forEach((timer, id) => {
      if (reduced || pending.get(id) !== timer.phase) {
        window.clearTimeout(timer.id); timers.current.delete(id);
      }
    });
    if (reduced) {
      if (pending.size) setEntries(previous => previous.filter(entry => entry.phase !== 'leaving')
        .map(entry => entry.phase === 'present' ? entry : { ...entry, phase: 'present' }));
      return;
    }
    pending.forEach((phase, seatId) => {
      if (timers.current.has(seatId)) return;
      const id = window.setTimeout(() => {
        timers.current.delete(seatId);
        setEntries(previous => settleCard(previous, seatId, phase));
      }, phase === 'leaving' ? 180 : 280);
      timers.current.set(seatId, { phase, id });
    });
  }, [entries, reduced]);

  return <>{entries.map(entry => <div key={entry.seat.id}
    className={`cy-seat-presence cy-seat-presence--${entry.phase}`}
    inert={entry.phase === 'leaving'} aria-hidden={entry.phase === 'leaving'}>
    <div className="cy-seat-presence__body">{render(entry.seat)}</div>
  </div>)}</>;
}
