/**
 * 气旋创建群聊配置面板（阶段 B）
 *
 * 右侧主界面填配置 → 点创建 → 建群 + 跑入会发言 → 进入群聊。
 * 配置项：群名、话题、build/plan 模式、初始工位多选 + 每个工位的入会发言行为。
 */

import { useState } from 'react';

type JoinBehavior = 'summary' | 'intro' | 'none';
type RoomMode = 'build' | 'plan';
interface SeatLite { id: string; title: string; }

const BEHAVIOR_LABEL: Record<JoinBehavior, string> = {
  summary: '工作摘要（读私聊近况）',
  intro: '自我介绍',
  none: '静默入会',
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
  const [title, setTitle] = useState('新群聊');
  const [topic, setTopic] = useState('自由讨论');
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
        title: title.trim() || '新群聊',
        topic: topic.trim() || '自由讨论',
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
      <h2 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-lg)' }}>新建群聊</h2>

      <label style={labelStyle}>群聊名称</label>
      <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>讨论话题</label>
      <input value={topic} onChange={e => setTopic(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>模式</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {(['build', 'plan'] as RoomMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{ ...modeBtnStyle, ...(mode === m ? modeBtnActiveStyle : null) }}>
            {m === 'build' ? 'build · 可读写工作区' : 'plan · 只读+联络，不动文件'}
          </button>
        ))}
      </div>

      <label style={labelStyle}>初始入会工位</label>
      {seats.length === 0 && <div style={{ opacity: .5, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>工作室还没有工位，先去左侧添加</div>}
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
                  {(Object.keys(BEHAVIOR_LABEL) as JoinBehavior[]).map(b => <option key={b} value={b}>{BEHAVIOR_LABEL[b]}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={submit} disabled={creating} className="btn btn--primary">
          {creating ? '创建中…（入会发言生成）' : '创建并进入'}
        </button>
        <button onClick={onCancel} disabled={creating} className="btn">取消</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', marginTop: 'var(--space-3)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', boxSizing: 'border-box' };
const modeBtnStyle: React.CSSProperties = { flex: 1, padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const modeBtnActiveStyle: React.CSSProperties = { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', fontWeight: 600 };
