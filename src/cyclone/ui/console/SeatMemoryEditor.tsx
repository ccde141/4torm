import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { readSeatMemory, saveSeatMemory } from './workshop-console-client';
import type { SeatMemoryDocument, SeatMemoryEntry } from './workshop-console-model';
import { formatConsoleTime, useConsoleText } from './console-text';
import { ConsoleIcon } from './ConsoleIcon';
import { subscribeCycloneChanges } from '../pages/cyclone-change-client';
import { reduceSeatMemoryFeedback, resolveSavedSeatMemory } from './seat-memory-state';

type Draft = { id?: string; title: string; content: string };
const blank = (): Draft => ({ title: '', content: '' });

export function SeatMemoryEditor({ workshopId, seatId, onChanged }: {
  workshopId: string; seatId: string; onChanged(): void;
}) {
  const text = useConsoleText();
  const alive = useRef(true);
  const [document, setDocument] = useState<SeatMemoryDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'saving' | null>('loading');
  const [feedback, report] = useReducer(reduceSeatMemoryFeedback, { readError: '', saveError: '' });
  const [saved, setSaved] = useState(false);
  const editor = useRef({ dirty, busy, selectedId: draft.id });
  editor.current = { dirty, busy, selectedId: draft.id };
  const generation = useRef(0);
  const reading = useRef(false);
  const newEntry = useRef(false);
  const load = useCallback(async (discard = false, initial = false) => {
    if (reading.current || editor.current.busy === 'saving') return;
    reading.current = true;
    const request = generation.current;
    if (discard || initial) setBusy('loading');
    try {
      const next = await readSeatMemory(workshopId, seatId);
      if (!alive.current || request !== generation.current) return;
      setDocument(next); report(discard ? { kind: 'reset' } : { kind: 'read', error: '' });
      if (discard || !editor.current.dirty) {
        setRevision(next.revision);
        setDraft(newEntry.current ? blank()
          : next.entries.find(entry => entry.id === editor.current.selectedId) ?? next.entries[0] ?? blank());
        setDirty(false);
      }
    } catch (cause) { if (alive.current) report({ kind: 'read', error: String((cause as Error).message || cause) }); }
    finally { reading.current = false; if (alive.current && (discard || initial)) setBusy(null); }
  }, [workshopId, seatId]);
  useEffect(() => {
    alive.current = true; void load(false, true);
    const timer = window.setInterval(() => void load(), 10_000);
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change' && event.workshopId === workshopId)) void load();
    });
    return () => { alive.current = false; window.clearInterval(timer); unsubscribe(); };
  }, [load, workshopId]);

  function select(entry?: SeatMemoryEntry) {
    newEntry.current = !entry;
    setDraft(entry ?? blank()); setRevision(document?.revision ?? 0); setDirty(false); setSaved(false); report({ kind: 'reset' });
  }
  async function save() {
    if (busy || !document || !draft.title.trim() || !draft.content.trim()) return;
    generation.current += 1;
    setBusy('saving'); setSaved(false);
    try {
      const next = await saveSeatMemory(workshopId, seatId, revision, {
        ...(draft.id ? { id: draft.id } : {}), title: draft.title.trim(), content: draft.content,
      });
      if (!alive.current) return;
      newEntry.current = false;
      const entry = resolveSavedSeatMemory(document, next, draft.id);
      setDocument(next); setRevision(next.revision); setDraft(entry); setDirty(false); setSaved(true); report({ kind: 'reset' }); onChanged();
    } catch (cause) { if (alive.current) report({ kind: 'save', error: String((cause as Error).message || cause) }); }
    finally { if (alive.current) setBusy(null); }
  }
  return <div><div className="cy-seat-intro"><h3>{text('岗位记忆', 'Seat memory')}</h3>
    <p>{text('项目约定、岗位经验与资料索引。', 'Project agreements, seat experience and material references.')}</p></div>
    {feedback.saveError && <p role="alert" className="cy-console-error">{feedback.saveError}</p>}
    {feedback.readError && <p role="alert" className="cy-console-error">{feedback.readError}</p>}
    <div className="cy-seat-memory-toolbar"><button type="button" className="cy-console-link" disabled={!!busy} onClick={() => void load(true)}>
      {dirty ? text('重新读取，放弃未保存修改', 'Reload and discard unsaved changes') : text('重新读取', 'Reload')}</button></div>
    {busy === 'loading' && <p role="status" className="cy-console-muted">{text('正在读取记忆…', 'Loading memory…')}</p>}
    {document && <div className="cy-seat-memory"><nav aria-label={text('工位记忆条目', 'Seat memories')}>
      {document.entries.map(entry => <button type="button" key={entry.id} aria-current={draft.id === entry.id ? 'page' : undefined}
        disabled={!!busy} onClick={() => select(entry)}>{entry.title}<small>{formatConsoleTime(entry.updatedAt, true)}</small></button>)}
      <button type="button" className="cy-console-link" disabled={!!busy} onClick={() => select()}><ConsoleIcon name="plus" />{text('新增记忆', 'Add memory')}</button>
    </nav><form className="cy-seat-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!!busy}><label>{text('标题', 'Title')}<input required maxLength={200} value={draft.title}
        onChange={event => { setDraft(current => ({ ...current, title: event.target.value })); setDirty(true); setSaved(false); }} /></label>
        <label>{text('记忆内容', 'Content')}<textarea rows={11} required value={draft.content}
          onChange={event => { setDraft(current => ({ ...current, content: event.target.value })); setDirty(true); setSaved(false); }} /></label></fieldset>
      <div className="cy-seat-form__actions"><span role="status">{saved ? text('记忆已保存', 'Memory saved') : ''}</span>
        <button type="submit" className="cy-console-button primary" disabled={!!busy || !draft.title.trim() || !draft.content.trim()}>
          {busy === 'saving' ? text('保存中…', 'Saving…') : text('保存记忆', 'Save memory')}</button></div>
    </form></div>}
  </div>;
}
