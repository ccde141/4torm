/**
 * 气旋工作室公告板 —— 工作室主区默认页（选中工作室、未进工位/群聊时展现）
 *
 * - 结构化：按条目组织；人在此增/改/删，保存时以增量操作（add/update/remove）提交，
 *   不整表覆盖 → 不会冲掉 agent 期间新增的条目
 * - 全体工位共享：条目注入进每个工位 system prompt（后端 buildBulletinSection）
 * - 全员可写 + 审计时间轴：所有工位/群聊都能改，每次改动进「更改记录」，人可随时撤回
 * - 热切换：不常驻 SSE；每轮工位/群聊结束 → 父层 loadWorkshop 拉一次盘刷新（非编辑态才跟随）
 * - 视觉：复用 config-modal.css 的 config-* 类 + cyclone.css 的 .bulletin-board 磨砂玻璃
 */

import { useState, useEffect, useRef } from 'react';
import '../../../styles/components/config-modal.css';

export interface BulletinEntry {
  id: string;
  text: string;
  author: string;
  updatedAt: number;
}

interface BulletinChange {
  seq: number;
  ts: number;
  actor: string;
  kind: 'add' | 'update' | 'remove' | 'restore' | 'revert';
  entryId: string;
  before: { text: string; author: string } | null;
  after: { text: string; author: string } | null;
  revertOf?: number;
}

/** 本地行：已存在条目带 id；新加行 id 为空 */
interface Row { id: string; text: string; author: string }

type BulletinOp =
  | { op: 'add'; text: string }
  | { op: 'update'; id: string; text: string }
  | { op: 'remove'; id: string };

async function readErrorMessage(r: Response, fallback: string): Promise<string> {
  const e = await r.json().catch(() => ({}));
  return e?.error || `${fallback}（HTTP ${r.status}）`;
}

function toRows(entries: BulletinEntry[]): Row[] {
  return entries.map(e => ({ id: e.id, text: e.text, author: e.author }));
}

/** 对比基线与当前行，算出增量操作 */
function diffOps(base: BulletinEntry[], rows: Row[]): BulletinOp[] {
  const ops: BulletinOp[] = [];
  const baseById = new Map(base.map(e => [e.id, e]));
  const seen = new Set<string>();
  for (const r of rows) {
    const text = r.text.trim();
    if (!r.id) { if (text) ops.push({ op: 'add', text }); continue; }
    seen.add(r.id);
    const b = baseById.get(r.id);
    if (b && b.text !== text) {
      if (text) ops.push({ op: 'update', id: r.id, text });
      else ops.push({ op: 'remove', id: r.id });   // 清空文本 = 删除
    }
  }
  for (const e of base) if (!seen.has(e.id)) ops.push({ op: 'remove', id: e.id });   // 被删掉的行
  return ops;
}

const clip = (s: string, n = 40) => s.length > n ? s.slice(0, n) + '…' : s;

/** 把一条改动描述成一句话 */
function describeChange(c: BulletinChange): string {
  const arrow = c.revertOf != null ? '↩ 撤回：' : '';
  if (c.before == null && c.after != null) return `${arrow}新增「${clip(c.after.text)}」`;
  if (c.before != null && c.after == null) return `${arrow}删除「${clip(c.before.text)}」`;
  if (c.before != null && c.after != null) return `${arrow}改「${clip(c.before.text, 24)}」→「${clip(c.after.text, 24)}」`;
  return arrow || '（无变化）';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function BulletinBoard({
  workshopId, title, entries, onSaved, onRenamed,
}: {
  workshopId: string;
  title?: string;
  entries: BulletinEntry[];
  onSaved?: (entries: BulletinEntry[]) => void;
  onRenamed?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(toRows(entries));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [changes, setChanges] = useState<BulletinChange[]>([]);
  const [reverting, setReverting] = useState<number | null>(null);
  // 基线 = 上次从盘加载的条目。非编辑态时随外部刷新跟随；编辑态（脏）时冻结不动
  const baseRef = useRef<BulletinEntry[]>(entries);

  const ops = diffOps(baseRef.current, rows);
  const dirty = ops.length > 0;

  useEffect(() => {
    // 非编辑态：跟随外部刷新（agent/他人写入即时呈现）。
    // 编辑态：基线冻结不动——用户的 rows 从它派生；agent 期间新增的条目保存后由服务端合并回来，
    // 绝不能并进基线，否则 diff 会把"用户没见过的条目"误判成删除而清掉。
    if (!dirty) { baseRef.current = entries; setRows(toRows(entries)); }
    if (showHistory) fetchHistory();   // 时间轴开着时，回合刷新 entries 也顺带刷新改动记录
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchHistory() {
    try {
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/bulletin-history`);
      if (r.ok) setChanges((await r.json()).changes ?? []);
    } catch { /* ignore */ }
  }

  // 一次性拉盘刷新（不常驻 SSE）：手动按钮 + 回到窗口时触发。编辑态不覆盖本地改动
  async function doRefresh() {
    try {
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/bulletin`);
      if (r.ok) {
        const b: { entries: BulletinEntry[] } = await r.json();
        if (!dirty) { baseRef.current = b.entries; setRows(toRows(b.entries)); onSaved?.(b.entries); }
      }
      if (showHistory) fetchHistory();
    } catch { /* ignore */ }
  }
  // 用 ref 承接最新闭包，focus 监听只注册一次却总读到最新 state
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = doRefresh;
  useEffect(() => {
    const h = () => refreshRef.current();
    window.addEventListener('focus', h);
    return () => window.removeEventListener('focus', h);
  }, []);

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) fetchHistory();
  }

  function updateRow(i: number, text: string) { setRows(rs => rs.map((r, j) => j === i ? { ...r, text } : r)); }
  function removeRow(i: number) { setRows(rs => rs.filter((_, j) => j !== i)); }
  function addRow() { setRows(rs => [...rs, { id: '', text: '', author: '人类' }]); }

  /** 应用服务端返回的 { entries, changes } */
  function applyResult(b: { entries: BulletinEntry[]; changes?: BulletinChange[] }) {
    baseRef.current = b.entries;
    setRows(toRows(b.entries));
    onSaved?.(b.entries);
    if (b.changes) setChanges(b.changes);
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/bulletin-mutate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });
      if (!r.ok) { alert(await readErrorMessage(r, '保存公告板失败')); return; }
      applyResult(await r.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (e) {
      alert(`保存公告板失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function commitRename() {
    const t = titleDraft.trim();
    setEditingTitle(false);
    if (!t || t === title) return;
    try {
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      if (!r.ok) { alert(await readErrorMessage(r, '重命名工作室失败')); return; }
      onRenamed?.();
    } catch (e) {
      alert(`重命名工作室失败：${(e as Error).message}`);
    }
  }

  async function revert(seq: number) {
    if (reverting != null) return;
    setReverting(seq);
    try {
      const r = await fetch(`/api/cyclone/workshop/${workshopId}/bulletin-revert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq }),
      });
      if (!r.ok) { alert(await readErrorMessage(r, '撤回失败')); return; }
      applyResult(await r.json());
    } catch (e) {
      alert(`撤回失败：${(e as Error).message}`);
    } finally {
      setReverting(null);
    }
  }

  return (
    <div className="bulletin-board" style={rootStyle}>
      <div className="config-modal-header">
        <div style={{ minWidth: 0 }}>
          {editingTitle ? (
            <input
              autoFocus
              className="config-input"
              style={{ fontSize: 'var(--font-lg)', fontWeight: 700, width: 'min(420px, 60vw)' }}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingTitle(false); }}
            />
          ) : (
            <h3
              title="双击重命名工作室"
              style={{ cursor: 'text' }}
              onDoubleClick={() => { setTitleDraft(title || ''); setEditingTitle(true); }}
            >📌 工作室公告板{title ? ` · ${title}` : ''}</h3>
          )}
          <p className="config-modal-subtitle">全体工位可见 · 人与工位皆可写；每次改动进「更改记录」，可随时撤回 · 双击标题改名</p>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignSelf: 'center' }}>
          <button onClick={doRefresh} style={ghostBtnStyle} title="从磁盘拉取最新（回到本窗口也会自动刷新）">
            ↻ 刷新
          </button>
          <button onClick={toggleHistory} style={{ ...ghostBtnStyle, ...(showHistory ? ghostBtnActiveStyle : null) }} title="查看/撤回改动记录">
            🕓 更改记录
          </button>
        </div>
      </div>

      {showHistory ? (
        <div style={bodyStyle}>
          {changes.length === 0 && <div style={emptyStyle}>还没有任何改动记录。</div>}
          {[...changes].reverse().map(c => (
            <div key={c.seq} style={histRowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={histDescStyle}>{describeChange(c)}</div>
                <div style={histMetaStyle}>{fmtTime(c.ts)} · {c.actor}{c.revertOf != null ? ` · 撤回 #${c.revertOf}` : ''}</div>
              </div>
              <button onClick={() => revert(c.seq)} disabled={reverting != null} style={revertBtnStyle} title="撤回这次改动">
                {reverting === c.seq ? '…' : '撤回'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={bodyStyle}>
            {rows.length === 0 && (
              <div style={emptyStyle}>还没有公告条目。写下全工作室共享的目标 / 约束 / 通知，让全体对齐同一份背景。</div>
            )}
            {rows.map((row, i) => (
              <div key={row.id || `new-${i}`} style={entryStyle}>
                <textarea
                  className="config-textarea"
                  style={entryTextareaStyle}
                  value={row.text}
                  onChange={e => updateRow(i, e.target.value)}
                  placeholder="一条公告：结论、目标或事项…"
                />
                <div style={entrySideStyle}>
                  {row.id && <span style={authorStyle} title={`最后写入：${row.author}`}>{row.author}</span>}
                  <button onClick={() => removeRow(i)} style={rowDelStyle} title="删除此条">×</button>
                </div>
              </div>
            ))}
            <button onClick={addRow} style={addBtnStyle}>＋ 添加条目</button>
          </div>

          <div className="config-modal-footer">
            {dirty && <span style={dirtyStyle}>● {ops.length} 处未保存改动</span>}
            <button
              className={`config-btn config-btn-save ${saved ? 'config-btn-done' : ''}`}
              onClick={save}
              disabled={saving || !dirty}
            >
              {saved ? '✓ 已保存' : saving ? '保存中…' : '保存公告板'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };
const bodyStyle: React.CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
  gap: 'var(--space-3)', padding: 'var(--space-5) var(--space-6)',
};
const emptyStyle: React.CSSProperties = {
  color: 'var(--color-text-tertiary)', fontSize: 'var(--font-sm)', textShadow: 'var(--text-halo)',
};
const entryStyle: React.CSSProperties = { display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch' };
const entryTextareaStyle: React.CSSProperties = { flex: 1, minHeight: 52, resize: 'vertical', boxSizing: 'border-box' };
const entrySideStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between',
  flexShrink: 0, width: 64,
};
const authorStyle: React.CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
};
const rowDelStyle: React.CSSProperties = {
  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1,
};
const addBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start', padding: 'var(--space-2) var(--space-3)',
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px dashed var(--glass-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-sm)', cursor: 'pointer', textShadow: 'var(--text-halo)',
};
const dirtyStyle: React.CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-accent)',
  alignSelf: 'center', marginRight: 'auto', textShadow: 'var(--text-halo)',
};
const ghostBtnStyle: React.CSSProperties = {
  alignSelf: 'center', padding: 'var(--space-1) var(--space-3)',
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-xs)', cursor: 'pointer', whiteSpace: 'nowrap', textShadow: 'var(--text-halo)',
};
const ghostBtnActiveStyle: React.CSSProperties = {
  background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)',
};
const histRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
};
const histDescStyle: React.CSSProperties = {
  fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)', textShadow: 'var(--text-halo)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const histMetaStyle: React.CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)', marginTop: 2,
};
const revertBtnStyle: React.CSSProperties = {
  flexShrink: 0, padding: '2px var(--space-3)', background: 'transparent',
  color: 'var(--color-text-secondary)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-xs)', cursor: 'pointer',
};
