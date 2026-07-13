import { useState, useEffect, useCallback } from 'react';
import {
  listMemory, createMemory, updateMemory, deleteMemory,
  type MemoryEntry, type MemoryCategory, type MemoryDraft,
} from '../../api/memory';
import '../../styles/components/config-modal.css';
import '../../styles/components/memory-panel.css';

const CATEGORY_META: Record<MemoryCategory, { label: string; color: string }> = {
  feedback: { label: '偏好/纠正', color: '#a78bfa' },
  fact: { label: '事实', color: '#38bdf8' },
  pitfall: { label: '踩坑', color: '#fb923c' },
  reference: { label: '资源', color: '#34d399' },
};
const CATEGORIES = Object.keys(CATEGORY_META) as MemoryCategory[];

interface Props {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

const EMPTY_DRAFT: MemoryDraft = { detail: '', category: 'fact', tags: [] };

export default function MemoryPanel({ agentId, agentName, onClose }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    listMemory(agentId)
      .then(es => { setEntries(es); setError(''); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [showTags, setShowTags] = useState(false);

  const startEdit = (e: MemoryEntry) => {
    setCreating(false);
    setEditingSlug(e.slug);
    setDraft({ detail: e.detail, category: e.category, tags: [...e.tags] });
    setShowTags(e.tags.length > 0);
  };
  const startCreate = () => {
    setEditingSlug(null);
    setCreating(true);
    setDraft(EMPTY_DRAFT);
    setShowTags(false);
  };
  const cancel = () => { setEditingSlug(null); setCreating(false); setDraft(EMPTY_DRAFT); setShowTags(false); };

  const save = async () => {
    if (!draft.detail.trim()) { setError('内容不能为空'); return; }
    setBusy(true);
    try {
      if (creating) await createMemory(agentId, draft);
      else if (editingSlug) await updateMemory(agentId, editingSlug, draft);
      cancel();
      reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (slug: string) => {
    setBusy(true);
    try { await deleteMemory(agentId, slug); reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const parseTags = (v: string) => setDraft(d => ({ ...d, tags: v.split(/[,，]/).map(t => t.trim()).filter(Boolean) }));

  const editor = (
    <div className="mem-editor">
      <label className="mem-label">想让 {agentName} 记住什么？</label>
      <textarea
        className="mem-textarea" rows={5} autoFocus
        placeholder={`直接把要它记住的事说清楚即可。\n例：本项目所有文件落盘都要用原子写（先写临时文件再改名），别用裸 writeFile。`}
        value={draft.detail} onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))}
      />
      <div className="mem-editor-row">
        <label className="mem-field-label">类别</label>
        <select
          className="mem-select" value={draft.category}
          onChange={e => setDraft(d => ({ ...d, category: e.target.value as MemoryCategory }))}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
        </select>
        {!showTags && (
          <button type="button" className="mem-link-btn" onClick={() => setShowTags(true)}>＋ 添加标签</button>
        )}
      </div>
      {showTags && (
        <input
          className="mem-input" placeholder="标签，逗号分隔（可选，留空即可，系统也会自动补）"
          value={draft.tags.join(', ')} onChange={e => parseTags(e.target.value)}
        />
      )}
      <p className="mem-hint">摘要与检索标签交给系统自动整理，专心写内容就好。</p>
      <div className="mem-editor-actions">
        <button className="mem-btn mem-btn--primary" disabled={busy} onClick={save}>保存</button>
        <button className="mem-btn" disabled={busy} onClick={cancel}>取消</button>
      </div>
    </div>
  );

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', width: 'min(680px, 92vw)' }}>
        <div className="config-modal-header">
          <div>
            <h2 className="config-modal-title">🧠 长期记忆</h2>
            <p className="config-modal-subtitle">{agentName} · 跨会话积累的经验（您可以随时查看与编辑）</p>
          </div>
          <button className="config-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="config-modal-body" style={{ overflowY: 'auto' }}>
          {error && <div className="mem-error">{error}</div>}

          {creating ? editor : (
            <button className="mem-btn mem-btn--add" onClick={startCreate}>＋ 手动新增一条</button>
          )}

          {loading ? (
            <div className="mem-empty">加载中…</div>
          ) : entries.length === 0 && !creating ? (
            <div className="mem-empty">还没有任何记忆。Agent 工作中会自动记录，你也可以手动新增。</div>
          ) : (
            <ul className="mem-list">
              {entries.map(e => (
                <li key={e.slug} className="mem-item">
                  {editingSlug === e.slug ? editor : (
                    <>
                      <div className="mem-item-head">
                        <span className="mem-badge" style={{ background: `${CATEGORY_META[e.category].color}22`, color: CATEGORY_META[e.category].color }}>
                          {CATEGORY_META[e.category].label}
                        </span>
                        <span className="mem-actions">
                          <button className="mem-icon-btn" title="编辑" onClick={() => startEdit(e)}>✎</button>
                          <button className="mem-icon-btn mem-icon-btn--danger" title="删除" onClick={() => remove(e.slug)}>🗑</button>
                        </span>
                      </div>
                      <p className="mem-detail">{e.detail}</p>
                      <div className="mem-foot">
                        {e.tags.map(t => <span key={t} className="mem-tag">#{t}</span>)}
                        <span className="mem-meta">
                          {e.summaryPending && <span className="mem-pending" title="摘要待 Agent 精炼">待精炼</span>}
                          来源 {e.source === 'human' ? '你' : e.source} · 更新 {e.updated.slice(0, 10)}
                        </span>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
