import { useEffect, useState, type ReactNode } from 'react';
import { reconcilePresence, removeExited, settleEntered, type PresenceEntry } from './presence-items';

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  scope?: string;
}

/** Visual presence follows the authoritative list; it never changes persistence state. */
export function PresenceItems<T>({ items, getKey, render, scope }: Props<T>) {
  const [entries, setEntries] = useState<PresenceEntry<T>[]>(() =>
    items.map(item => ({ key: getKey(item), item, phase: 'present' })));

  useEffect(() => {
    setEntries(previous => reconcilePresence(previous, items, getKey));
  }, [items, getKey]);

  useEffect(() => {
    const entering = entries.some(entry => entry.phase === 'entering');
    const leaving = entries.filter(entry => entry.phase === 'leaving');
    if (!entering && !leaving.length) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const enterTimer = entering ? window.setTimeout(() =>
      setEntries(settleEntered), reduced ? 0 : 280) : undefined;
    const exitTimers = leaving.map(entry => window.setTimeout(() =>
      setEntries(previous => removeExited(previous, entry.key)), reduced ? 0 : 180));
    return () => {
      if (enterTimer !== undefined) window.clearTimeout(enterTimer);
      exitTimers.forEach(window.clearTimeout);
    };
  }, [entries]);

  return <>{entries.map(entry => <div key={entry.key}
    className={`entity-presence entity-presence--${entry.phase}`}
    data-presence-key={entry.key} data-presence-scope={scope}
    inert={entry.phase === 'leaving'} aria-hidden={entry.phase === 'leaving'}>
    <div className="entity-presence__body">{render(entry.item)}</div>
  </div>)}</>;
}
