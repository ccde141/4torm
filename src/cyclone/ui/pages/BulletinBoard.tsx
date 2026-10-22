/**
 * 气旋工作室公告板 —— 以完整条目呈现共享内容，编辑后统一提交增量操作。
 *
 * - 结构化：按条目组织；人在此增/改/删，保存时以增量操作（add/update/remove）提交，
 *   不整表覆盖 → 不会冲掉 agent 期间新增的条目
 * - 全体工位共享：条目注入进每个工位 system prompt（后端 buildBulletinSection）
 * - 全员可写 + 审计时间轴：所有工位/群聊都能改，每次改动进「更改记录」，人可随时撤回
 * - 热切换：不常驻 SSE；每轮工位/群聊结束 → 父层 loadWorkshop 拉一次盘刷新（非编辑态才跟随）
 * - 条目默认完整阅读；局部编辑只更新草稿，不改变底部统一保存的语义
 */

import { backendFetch } from '../../../lib/backend-client';
import { useState, useEffect, useRef } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import {
  mutateCycloneBulletin,
  renameCycloneWorkshop,
  revertCycloneBulletin,
} from './cyclone-control-client';
import {
  addBtnStyle, bodyStyle, dirtyStyle, emptyStyle, ghostBtnActiveStyle, ghostBtnStyle,
  histDescStyle, histMetaStyle, histRowStyle, revertBtnStyle, rootStyle,
} from './bulletin-styles';
import { BulletinEntryCard } from './BulletinEntryCard';
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
interface Row { key: string; id: string; text: string; author: string; updatedAt?: number }

type BulletinOp =
  | { op: 'add'; text: string }
  | { op: 'update'; id: string; text: string }
  | { op: 'remove'; id: string };

function toRows(entries: BulletinEntry[]): Row[] {
  return entries.map(e => ({ key: `entry-${e.id}`, id: e.id, text: e.text, author: e.author, updatedAt: e.updatedAt }));
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

/** 把一条改动描述成一句话 */
function describeChange(c: BulletinChange, t: ReturnType<typeof useLocale>['t']): string {
  const prefix = c.revertOf != null ? t('cyclone.bulletin.changeReverted') : '';
  if (c.before == null && c.after != null) return t('cyclone.bulletin.changeAdd', { prefix, text: c.after.text });
  if (c.before != null && c.after == null) return t('cyclone.bulletin.changeRemove', { prefix, text: c.before.text });
  if (c.before != null && c.after != null) return t('cyclone.bulletin.changeUpdate', {
    prefix, before: c.before.text, after: c.after.text,
  });
  return prefix || t('cyclone.bulletin.changeNone');
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
  const { t } = useLocale();
  const [rows, setRows] = useState<Row[]>(toRows(entries));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [changes, setChanges] = useState<BulletinChange[]>([]);
  const [reverting, setReverting] = useState<number | null>(null);
  const nextDraftKey = useRef(0);
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
      const r = await backendFetch(`/api/cyclone/workshop/${workshopId}/bulletin-history`);
      if (r.ok) setChanges((await r.json()).changes ?? []);
    } catch { /* ignore */ }
  }

  // 一次性拉盘刷新（不常驻 SSE）：手动按钮 + 回到窗口时触发。编辑态不覆盖本地改动
  async function doRefresh() {
    try {
      const r = await backendFetch(`/api/cyclone/workshop/${workshopId}/bulletin`);
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
  function addRow() {
    const key = `draft-${nextDraftKey.current++}`;
    setRows(rs => [...rs, { key, id: '', text: '', author: '人类' }]);
  }

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
      applyResult(await mutateCycloneBulletin(workshopId, ops) as {
        entries: BulletinEntry[]; changes?: BulletinChange[];
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (e) {
      alert(t('cyclone.bulletin.errorDetail', { prefix: t('cyclone.bulletin.saveFailed'), error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  async function commitRename() {
    const nextTitle = titleDraft.trim();
    setEditingTitle(false);
    if (!nextTitle || nextTitle === title) return;
    try {
      await renameCycloneWorkshop(workshopId, nextTitle);
      onRenamed?.();
    } catch (e) {
      alert(t('cyclone.bulletin.errorDetail', { prefix: t('cyclone.bulletin.renameFailed'), error: (e as Error).message }));
    }
  }

  async function revert(seq: number) {
    if (reverting != null) return;
    setReverting(seq);
    try {
      applyResult(await revertCycloneBulletin(workshopId, seq) as {
        entries: BulletinEntry[]; changes?: BulletinChange[];
      });
    } catch (e) {
      alert(t('cyclone.bulletin.errorDetail', { prefix: t('cyclone.bulletin.revertFailed'), error: (e as Error).message }));
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
              title={t('cyclone.bulletin.renameTitle')}
              style={{ cursor: 'text' }}
              onDoubleClick={() => { setTitleDraft(title || ''); setEditingTitle(true); }}
            >📌 {t('cyclone.bulletin.title')}{title ? ` · ${title}` : ''}</h3>
          )}
          <p className="config-modal-subtitle">{t('cyclone.bulletin.subtitle')}</p>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignSelf: 'center' }}>
          <button onClick={doRefresh} style={ghostBtnStyle} title={t('cyclone.bulletin.refreshTitle')}>
            {t('cyclone.bulletin.refresh')}
          </button>
          <button onClick={toggleHistory} style={{ ...ghostBtnStyle, ...(showHistory ? ghostBtnActiveStyle : null) }} title={t('cyclone.bulletin.historyTitle')}>
            {t('cyclone.bulletin.history')}
          </button>
        </div>
      </div>

      {showHistory ? (
        <div style={bodyStyle}>
          {changes.length === 0 && <div style={emptyStyle}>{t('cyclone.bulletin.noHistory')}</div>}
          {[...changes].reverse().map(c => (
            <div key={c.seq} style={histRowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={histDescStyle}>{describeChange(c, t)}</div>
                <div style={histMetaStyle}>{fmtTime(c.ts)} · {c.actor === '人类' ? t('cyclone.bulletin.authorHuman') : c.actor}{c.revertOf != null ? ` · ${t('cyclone.bulletin.revertedMeta', { seq: c.revertOf })}` : ''}</div>
              </div>
              <button onClick={() => revert(c.seq)} disabled={reverting != null} style={revertBtnStyle} title={t('cyclone.bulletin.revertTitle')}>
                {reverting === c.seq ? '…' : t('cyclone.bulletin.revert')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={bodyStyle}>
            {rows.length === 0 && (
              <div style={emptyStyle}>{t('cyclone.bulletin.empty')}</div>
            )}
            {rows.map((row, i) => <BulletinEntryCard key={row.key} text={row.text} author={row.author}
              updatedAt={row.updatedAt} isNew={!row.id} onChange={value => updateRow(i, value)}
              onRemove={() => removeRow(i)} />)}
            <button onClick={addRow} style={addBtnStyle}>{t('cyclone.bulletin.addEntry')}</button>
          </div>

          <div className="config-modal-footer">
            {dirty && <span style={dirtyStyle}>{t('cyclone.bulletin.unsaved', { count: ops.length })}</span>}
            <button
              className={`config-btn config-btn-save ${saved ? 'config-btn-done' : ''}`}
              onClick={save}
              disabled={saving || !dirty}
            >
              {saved ? t('cyclone.bulletin.saved') : saving ? t('cyclone.bulletin.saving') : t('cyclone.bulletin.save')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
