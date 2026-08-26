/**
 * 气旋创建群聊配置面板（阶段 B）
 *
 * 右侧主界面填配置 → 点创建 → 建群 + 跑入会发言 → 进入群聊。
 * 配置项：群名、话题、build/plan 模式、初始工位多选 + 每个工位的入会发言行为。
 */

import { useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';

type JoinBehavior = 'summary' | 'intro' | 'none';
type RoomMode = 'build' | 'plan';
interface SeatLite { id: string; title: string; }

const BEHAVIOR_KEY: Record<JoinBehavior, MessageKey> = {
  summary: 'cyclone.room.behaviorSummaryLong',
  intro: 'cyclone.room.behaviorIntro',
  none: 'cyclone.room.behaviorNone',
};

export default function CreateRoomPanel({ seats, onCreate, onCancel }: {
  seats: SeatLite[];
  /** 返回创建好的 roomId（用于跳转）；入会发言由本面板内部流式跑完后再调 */
  onCreate: (cfg: {
    title: string; topic: string; mode: RoomMode;
    participantSeatIds: string[];
    intros: Array<{ seatId: string; behavior: JoinBehavior }>;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [title, setTitle] = useState(() => t('cyclone.room.defaultTitle'));
  const [topic, setTopic] = useState(() => t('cyclone.room.defaultTopic'));
  const [mode, setMode] = useState<RoomMode>('build');
  const [picked, setPicked] = useState<Record<string, JoinBehavior>>({});
  const [creating, setCreating] = useState(false);

  const pickedIds = Object.keys(picked);

  function toggleSeat(id: string) {
    setPicked(p => {
      const next = { ...p };
      if (id in next) delete next[id];
      else next[id] = 'summary';
      return next;
    });
  }

  async function submit() {
    if (creating) return;
    setCreating(true);
    try {
      await onCreate({
        title: title.trim() || t('cyclone.room.defaultTitle'),
        topic: topic.trim() || t('cyclone.room.defaultTopic'),
        mode,
        participantSeatIds: pickedIds,
        intros: pickedIds.map(id => ({ seatId: id, behavior: picked[id] })),
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)', maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-lg)' }}>{t('cyclone.room.createTitle')}</h2>

      <label style={labelStyle}>{t('cyclone.room.name')}</label>
      <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>{t('cyclone.room.topic')}</label>
      <input value={topic} onChange={e => setTopic(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>{t('cyclone.room.mode')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {(['build', 'plan'] as RoomMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{ ...modeBtnStyle, ...(mode === m ? modeBtnActiveStyle : null) }}>
            {t(m === 'build' ? 'cyclone.room.modeBuild' : 'cyclone.room.modePlan')}
          </button>
        ))}
      </div>

      <label style={labelStyle}>{t('cyclone.room.initialSeats')}</label>
      {seats.length === 0 && <div style={{ opacity: .5, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>{t('cyclone.room.noSeats')}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {seats.map(s => {
          const on = s.id in picked;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: on ? 'var(--color-accent-subtle)' : 'transparent' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', flex: 1 }}>
                <input type="checkbox" checked={on} onChange={() => toggleSeat(s.id)} />
                <span>{s.title}</span>
              </label>
              {on && (
                <select value={picked[s.id]} onChange={e => setPicked(p => ({ ...p, [s.id]: e.target.value as JoinBehavior }))}
                  style={{ padding: '2px 6px', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-xs)' }}>
                  {(Object.keys(BEHAVIOR_KEY) as JoinBehavior[]).map(b => <option key={b} value={b}>{t(BEHAVIOR_KEY[b])}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={submit} disabled={creating} className="btn btn--primary">
          {creating ? t('cyclone.room.creating') : t('cyclone.room.createAndEnter')}
        </button>
        <button onClick={onCancel} disabled={creating} className="btn">{t('common.cancel')}</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', boxSizing: 'border-box' };
const modeBtnStyle: React.CSSProperties = { flex: 1, padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const modeBtnActiveStyle: React.CSSProperties = { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', fontWeight: 600 };
