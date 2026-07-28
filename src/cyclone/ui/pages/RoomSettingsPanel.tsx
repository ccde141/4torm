import { useEffect, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { inviteSeatToRoom, type JoinBehavior } from './room-invite';
import { readRoomError, type RoomData } from './room-messages';
import { roomSeatName } from './room-seat-name';
import '../../../styles/components/cyclone-room-settings.css';

interface SeatLite { id: string; title: string; }

const BEHAVIOR_LABEL: Record<JoinBehavior, string> = {
  summary: '工作摘要',
  intro: '自我介绍',
  none: '静默入会',
};

export default function RoomSettingsPanel({ room, seats, roomUrl, locked, onChanged }: {
  room: RoomData;
  seats: SeatLite[];
  roomUrl: string;
  locked: boolean;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(room.title);
  const [topic, setTopic] = useState(room.topic);
  const [seatId, setSeatId] = useState('');
  const [behavior, setBehavior] = useState<JoinBehavior>('summary');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(room.title);
    setTopic(room.topic);
  }, [room.id, room.title, room.topic]);

  const participantSet = new Set(room.participantSeatIds);
  const candidates = seats.filter(seat => !participantSet.has(seat.id));
  const seatName = (id: string) => roomSeatName(id, seats, room.publicMessages);
  const writeLocked = locked || busy;

  async function mutate(action: string, body: Record<string, unknown>, fallback: string): Promise<boolean> {
    if (writeLocked) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${roomUrl}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readRoomError(response, fallback));
      await onChanged();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === room.title) return;
    if (await mutate('rename', { title: next }, '保存会议名称失败')) setNotice('会议名称已保存');
  }

  async function saveTopic() {
    const next = topic.trim();
    if (!next || next === room.topic) return;
    if (await mutate('set-topic', { topic: next }, '保存会议话题失败')) setNotice('会议话题已保存');
  }

  async function moveSeat(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= room.participantSeatIds.length) return;
    const seatIds = [...room.participantSeatIds];
    [seatIds[index], seatIds[target]] = [seatIds[target], seatIds[index]];
    await mutate('reorder', { seatIds }, '调整发言顺序失败');
  }

  async function leaveSeat(id: string) {
    const title = seatName(id);
    const approved = await confirm({
      title: `请「${title}」离开会议？`,
      message: '工位、私聊、历史发言与派发记录都会保留。',
      confirmText: '请离会议', danger: true,
    });
    if (!approved) return;
    await mutate('leave', { seatId: id }, '请离会议失败');
  }

  async function inviteSeat() {
    if (!seatId || writeLocked) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await inviteSeatToRoom(fetch, roomUrl, seatId, behavior);
      await onChanged();
      setSeatId('');
      if (result.introError) setError(`成员已加入，但入会发言失败：${result.introError}`);
      else setNotice('工位已加入会议');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`cyclone-settings-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="cyclone-settings-trigger__glyph" aria-hidden="true">⌁</span>
        会议设置
        {locked && <span className="cyclone-settings-trigger__lock">运行中</span>}
      </button>
      {open && (
        <div className="cyclone-settings-layer" onMouseDown={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <aside className="cyclone-settings-panel" aria-label="会议设置">
            <header className="cyclone-settings-panel__header">
              <div>
                <span className="cyclone-settings-panel__eyebrow">CYCLONE ROOM</span>
                <h2>会议设置</h2>
              </div>
              <button type="button" className="cyclone-settings-panel__close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </header>

            {locked && <div className="cyclone-settings-lock">会议正在处理内容，设置暂时锁定</div>}
            {error && <div className="cyclone-settings-feedback is-error" role="alert">{error}</div>}
            {notice && <div className="cyclone-settings-feedback" role="status">{notice}</div>}

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>01</span>会议信息</div>
              <label className="cyclone-settings-field">
                <span>名称</span>
                <div><input value={title} onChange={event => setTitle(event.target.value)} disabled={locked || busy} />
                  <button onClick={saveTitle} disabled={locked || busy || !title.trim() || title.trim() === room.title}>保存</button></div>
              </label>
              <label className="cyclone-settings-field">
                <span>话题</span>
                <div><input value={topic} onChange={event => setTopic(event.target.value)} disabled={locked || busy} />
                  <button onClick={saveTopic} disabled={locked || busy || !topic.trim() || topic.trim() === room.topic}>保存</button></div>
              </label>
              <div className="cyclone-settings-mode" aria-label="会议模式">
                {(['build', 'plan'] as const).map(mode => (
                  <button key={mode} className={room.mode === mode ? 'is-active' : ''} disabled={locked || busy}
                    onClick={() => mutate('set-mode', { mode }, '切换会议模式失败')}>
                    <strong>{mode}</strong><span>{mode === 'build' ? '可写工作区' : '只读规划'}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>02</span>参会工位与顺序</div>
              <div className="cyclone-settings-roster">
                {room.participantSeatIds.length === 0 && <div className="cyclone-settings-empty">会议尚无参会工位</div>}
                {room.participantSeatIds.map((id, index) => (
                  <div className="cyclone-settings-seat" key={id}>
                    <span className="cyclone-settings-seat__order">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{seatName(id)}</strong>
                    <div className="cyclone-settings-seat__actions">
                      <button disabled={locked || busy || index === 0} onClick={() => moveSeat(index, -1)} aria-label="上移">↑</button>
                      <button disabled={locked || busy || index === room.participantSeatIds.length - 1} onClick={() => moveSeat(index, 1)} aria-label="下移">↓</button>
                      <button className="is-danger" disabled={locked || busy} onClick={() => leaveSeat(id)}>请离会议</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>03</span>邀请工位</div>
              {candidates.length > 0 ? (
                <div className="cyclone-settings-invite">
                  <select value={seatId} disabled={locked || busy} onChange={event => setSeatId(event.target.value)}>
                    <option value="">选择尚未入会的工位</option>
                    {candidates.map(seat => <option key={seat.id} value={seat.id}>{seat.title}</option>)}
                  </select>
                  <div className="cyclone-settings-behaviors">
                    {(Object.keys(BEHAVIOR_LABEL) as JoinBehavior[]).map(value => (
                      <button key={value} className={behavior === value ? 'is-active' : ''} disabled={locked || busy}
                        onClick={() => setBehavior(value)}>{BEHAVIOR_LABEL[value]}</button>
                    ))}
                  </div>
                  <button className="cyclone-settings-invite__submit" disabled={locked || busy || !seatId} onClick={inviteSeat}>
                    {busy ? '处理中…' : '邀请进入会议'}
                  </button>
                </div>
              ) : <div className="cyclone-settings-empty">所有工位都已在会议中</div>}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
