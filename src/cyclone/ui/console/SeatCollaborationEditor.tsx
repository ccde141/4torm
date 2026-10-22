import { useEffect, useRef, useState } from 'react';
import { updateSeatCollaboration } from './workshop-console-client';
import type { ConsoleSeat, SeatCollaboration } from './workshop-console-model';
import { useConsoleText } from './console-text';
import { ConsoleIcon } from './ConsoleIcon';

export function SeatCollaborationEditor({ workshopId, title, seat, seats, onChanged }: {
  workshopId: string; title: string; seat: ConsoleSeat; seats: ConsoleSeat[]; onChanged(): void;
}) {
  const text = useConsoleText();
  const [policy, setPolicy] = useState(seat.collaboration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const tools: Array<{ id: keyof SeatCollaboration; title: string; description: string }> = [
    { id: 'contact', title: text('工位联络', 'Seat contact'), description: text('向其他工位发送消息并接收回复。', 'Send messages to other seats and receive replies.') },
    { id: 'dispatch', title: text('任务派发', 'Task dispatch'), description: text('将任务交给其他工位执行。', 'Assign tasks to other seats.') },
    { id: 'bulletin', title: text('工作室公告', 'Workshop bulletin'), description: text('读取和发布工作室公告。', 'Read and post workshop announcements.') },
  ];
  async function save() {
    if (busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const next = await updateSeatCollaboration(workshopId, seat.id, policy);
      if (!alive.current) return;
      setPolicy(next); setSaved(true); onChanged();
    } catch (cause) { if (alive.current) setError(String((cause as Error).message || cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div><div className="cy-seat-intro"><h3>{text('工位协作工具', 'Seat collaboration tools')}</h3>
    <p>{title} · {seat.title}</p></div>
    {tools.map(tool => <div className="cy-seat-local-tool" key={tool.id}><span><ConsoleIcon name="collaboration" /></span>
      <div><h4>{tool.title}</h4><p>{tool.description}</p></div>
      <button type="button" className="cy-seat-switch" role="switch" aria-label={tool.title} aria-checked={policy[tool.id]} disabled={busy}
        onClick={() => { setPolicy(current => ({ ...current, [tool.id]: !current[tool.id] })); setSaved(false); }} /></div>)}
    <section className="cy-seat-section"><h4>{text('本工作室的其他工位', 'Other seats in this workshop')}</h4>
      <div className="cy-seat-roster">{seats.filter(item => item.id !== seat.id).map(item => <span key={item.id}>{item.title}</span>)}</div>
      <p className="cy-console-muted">{text('联络关系见「协作结构」。', 'Contact connections are shown in Collaboration structure.')}</p></section>
    {error && <p className="cy-console-error" role="alert">{error}</p>}
    <div className="cy-seat-form__actions"><span role="status">{saved ? text('协作设置已保存', 'Collaboration settings saved') : ''}</span>
      <button type="button" className="cy-console-button primary" disabled={busy} onClick={() => void save()}>
        {busy ? text('保存中…', 'Saving…') : text('保存协作设置', 'Save collaboration settings')}</button></div>
  </div>;
}
