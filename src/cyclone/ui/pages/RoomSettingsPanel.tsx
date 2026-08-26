import { useEffect, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { inviteSeatToRoom, type JoinBehavior } from './room-invite';
import { readRoomError, type RoomData } from './room-messages';
import { roomSeatName } from './room-seat-name';
import '../../../styles/components/cyclone-room-settings.css';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';

interface SeatLite { id: string; title: string; }

const BEHAVIOR_KEY: Record<JoinBehavior, MessageKey> = {
  summary: 'cyclone.room.behaviorSummary',
  intro: 'cyclone.room.behaviorIntro',
  none: 'cyclone.room.behaviorNone',
};

export default function RoomSettingsPanel({ room, seats, roomUrl, locked, onChanged }: {
  room: RoomData;
  seats: SeatLite[];
  roomUrl: string;
  locked: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
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
  const seatName = (id: string) => roomSeatName(id, seats, room.publicMessages, t('cyclone.settings.deletedSeat'));
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
    if (await mutate('rename', { title: next }, t('cyclone.settings.saveNameFailed'))) setNotice(t('cyclone.settings.nameSaved'));
  }

  async function saveTopic() {
    const next = topic.trim();
    if (!next || next === room.topic) return;
    if (await mutate('set-topic', { topic: next }, t('cyclone.settings.saveTopicFailed'))) setNotice(t('cyclone.settings.topicSaved'));
  }

  async function moveSeat(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= room.participantSeatIds.length) return;
    const seatIds = [...room.participantSeatIds];
    [seatIds[index], seatIds[target]] = [seatIds[target], seatIds[index]];
    await mutate('reorder', { seatIds }, t('cyclone.settings.reorderFailed'));
  }

  async function leaveSeat(id: string) {
    const title = seatName(id);
    const approved = await confirm({
      title: t('cyclone.settings.leaveTitle', { seat: title }),
      message: t('cyclone.settings.leaveMessage'),
      confirmText: t('cyclone.settings.leave'), danger: true,
    });
    if (!approved) return;
    await mutate('leave', { seatId: id }, t('cyclone.settings.leaveFailed'));
  }

  async function inviteSeat() {
    if (!seatId || writeLocked) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await inviteSeatToRoom(fetch, roomUrl, seatId, behavior, {
        joinFailed: t('cyclone.roomInvite.joinFailed'),
        introFailed: t('cyclone.roomInvite.introFailed'),
        missingStream: t('cyclone.roomInvite.missingStream'),
        disconnected: t('cyclone.roomInvite.disconnected'),
      });
      await onChanged();
      setSeatId('');
      if (result.introError) setError(t('cyclone.settings.introFailed', { error: result.introError }));
      else setNotice(t('cyclone.settings.joined'));
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
        {t('cyclone.settings.title')}
        {locked && <span className="cyclone-settings-trigger__lock">{t('cyclone.settings.running')}</span>}
      </button>
      {open && (
        <div className="cyclone-settings-layer" onMouseDown={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <aside className="cyclone-settings-panel" aria-label={t('cyclone.settings.title')}>
            <header className="cyclone-settings-panel__header">
              <div>
                <span className="cyclone-settings-panel__eyebrow">CYCLONE ROOM</span>
                <h2>{t('cyclone.settings.title')}</h2>
              </div>
              <button type="button" className="cyclone-settings-panel__close" onClick={() => setOpen(false)} aria-label={t('cyclone.settings.close')}>×</button>
            </header>

            {locked && <div className="cyclone-settings-lock">{t('cyclone.settings.locked')}</div>}
            {error && <div className="cyclone-settings-feedback is-error" role="alert">{error}</div>}
            {notice && <div className="cyclone-settings-feedback" role="status">{notice}</div>}

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>01</span>{t('cyclone.settings.info')}</div>
              <label className="cyclone-settings-field">
                <span>{t('cyclone.settings.name')}</span>
                <div><input value={title} onChange={event => setTitle(event.target.value)} disabled={locked || busy} />
                  <button onClick={saveTitle} disabled={locked || busy || !title.trim() || title.trim() === room.title}>{t('common.save')}</button></div>
              </label>
              <label className="cyclone-settings-field">
                <span>{t('cyclone.settings.topic')}</span>
                <div><input value={topic} onChange={event => setTopic(event.target.value)} disabled={locked || busy} />
                  <button onClick={saveTopic} disabled={locked || busy || !topic.trim() || topic.trim() === room.topic}>{t('common.save')}</button></div>
              </label>
              <div className="cyclone-settings-mode" aria-label={t('cyclone.settings.mode')}>
                {(['build', 'plan'] as const).map(mode => (
                  <button key={mode} className={room.mode === mode ? 'is-active' : ''} disabled={locked || busy}
                    onClick={() => mutate('set-mode', { mode }, t('cyclone.settings.modeFailed'))}>
                    <strong>{mode}</strong><span>{t(mode === 'build' ? 'cyclone.settings.build' : 'cyclone.settings.plan')}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>02</span>{t('cyclone.settings.roster')}</div>
              <div className="cyclone-settings-roster">
                {room.participantSeatIds.length === 0 && <div className="cyclone-settings-empty">{t('cyclone.settings.emptyRoster')}</div>}
                {room.participantSeatIds.map((id, index) => (
                  <div className="cyclone-settings-seat" key={id}>
                    <span className="cyclone-settings-seat__order">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{seatName(id)}</strong>
                    <div className="cyclone-settings-seat__actions">
                      <button disabled={locked || busy || index === 0} onClick={() => moveSeat(index, -1)} aria-label={t('cyclone.settings.moveUp')}>↑</button>
                      <button disabled={locked || busy || index === room.participantSeatIds.length - 1} onClick={() => moveSeat(index, 1)} aria-label={t('cyclone.settings.moveDown')}>↓</button>
                      <button className="is-danger" disabled={locked || busy} onClick={() => leaveSeat(id)}>{t('cyclone.settings.leave')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="cyclone-settings-section">
              <div className="cyclone-settings-section__title"><span>03</span>{t('cyclone.settings.invite')}</div>
              {candidates.length > 0 ? (
                <div className="cyclone-settings-invite">
                  <select value={seatId} disabled={locked || busy} onChange={event => setSeatId(event.target.value)}>
                    <option value="">{t('cyclone.settings.selectSeat')}</option>
                    {candidates.map(seat => <option key={seat.id} value={seat.id}>{seat.title}</option>)}
                  </select>
                  <div className="cyclone-settings-behaviors">
                    {(Object.keys(BEHAVIOR_KEY) as JoinBehavior[]).map(value => (
                      <button key={value} className={behavior === value ? 'is-active' : ''} disabled={locked || busy}
                        onClick={() => setBehavior(value)}>{t(BEHAVIOR_KEY[value])}</button>
                    ))}
                  </div>
                  <button className="cyclone-settings-invite__submit" disabled={locked || busy || !seatId} onClick={inviteSeat}>
                    {busy ? t('cyclone.settings.processing') : t('cyclone.settings.inviteSubmit')}
                  </button>
                </div>
              ) : <div className="cyclone-settings-empty">{t('cyclone.settings.allPresent')}</div>}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
