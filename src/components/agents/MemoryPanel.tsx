import { useState, useEffect, useCallback } from 'react';
import {
  listMemory, createMemory, updateMemory, deleteMemory,
  type MemoryEntry, type MemoryCategory, type MemoryDraft,
} from '../../api/memory';
import '../../styles/components/config-modal.css';
import '../../styles/components/memory-panel.css';
import { useLocale } from '../../i18n/LocaleContext';

const CATEGORY_META: Record<MemoryCategory, { label: 'memory.feedback' | 'memory.fact' | 'memory.pitfall' | 'memory.reference'; color: string }> = {
  feedback: { label: 'memory.feedback', color: '#a78bfa' },
  fact: { label: 'memory.fact', color: '#38bdf8' },
  pitfall: { label: 'memory.pitfall', color: '#fb923c' },
  reference: { label: 'memory.reference', color: '#34d399' },
};
const CATEGORIES = Object.keys(CATEGORY_META) as MemoryCategory[];

interface Props {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

const EMPTY_DRAFT: MemoryDraft = { detail: '', category: 'fact', tags: [] };

export default function MemoryPanel({ agentId, agentName, onClose }: Props) {
  const { t } = useLocale();
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
    if (!draft.detail.trim()) { setError(t('memory.required')); return; }
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
      <label className="mem-label">{t('memory.prompt', { agent: agentName })}</label>
      <textarea
        className="mem-textarea" rows={5} autoFocus
        placeholder={t('memory.placeholder')}
        value={draft.detail} onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))}
      />
      <div className="mem-editor-row">
        <label className="mem-field-label">{t('memory.category')}</label>
        <select
          className="mem-select" value={draft.category}
          onChange={e => setDraft(d => ({ ...d, category: e.target.value as MemoryCategory }))}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_META[c].label)}</option>)}
        </select>
        {!showTags && (
          <button type="button" className="mem-link-btn" onClick={() => setShowTags(true)}>{t('memory.addTags')}</button>
        )}
      </div>
      {showTags && (
        <input
          className="mem-input" placeholder={t('memory.tagsPlaceholder')}
          value={draft.tags.join(', ')} onChange={e => parseTags(e.target.value)}
        />
      )}
      <p className="mem-hint">{t('memory.hint')}</p>
      <div className="mem-editor-actions">
        <button className="mem-btn mem-btn--primary" disabled={busy} onClick={save}>{t('common.save')}</button>
        <button className="mem-btn" disabled={busy} onClick={cancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', width: 'min(680px, 92vw)' }}>
        <div className="config-modal-header">
          <div>
            <h2 className="config-modal-title">{t('memory.title')}</h2>
            <p className="config-modal-subtitle">{t('memory.subtitle', { agent: agentName })}</p>
          </div>
          <button className="config-modal-close" onClick={onClose} aria-label={t('memory.close')}>✕</button>
        </div>

        <div className="config-modal-body" style={{ overflowY: 'auto' }}>
          {error && <div className="mem-error">{error}</div>}

          {creating ? editor : (
            <button className="mem-btn mem-btn--add" onClick={startCreate}>{t('memory.add')}</button>
          )}

          {loading ? (
            <div className="mem-empty">{t('common.loading')}</div>
          ) : entries.length === 0 && !creating ? (
            <div className="mem-empty">{t('memory.empty')}</div>
          ) : (
            <ul className="mem-list">
              {entries.map(e => (
                <li key={e.slug} className="mem-item">
                  {editingSlug === e.slug ? editor : (
                    <>
                      <div className="mem-item-head">
                        <span className="mem-badge" style={{ background: `${CATEGORY_META[e.category].color}22`, color: CATEGORY_META[e.category].color }}>
                          {t(CATEGORY_META[e.category].label)}
                        </span>
                        <span className="mem-actions">
                          <button className="mem-icon-btn" title={t('common.edit')} aria-label={t('memory.editLabel')} onClick={() => startEdit(e)}>✎</button>
                          <button className="mem-icon-btn mem-icon-btn--danger" title={t('common.delete')} aria-label={t('memory.deleteLabel')} onClick={() => remove(e.slug)}>🗑</button>
                        </span>
                      </div>
                      <p className="mem-detail">{e.detail}</p>
                      <div className="mem-foot">
                        {e.tags.map(t => <span key={t} className="mem-tag">#{t}</span>)}
                        <span className="mem-meta">
                          {e.summaryPending && <span className="mem-pending" title={t('memory.pendingTitle')}>{t('memory.pending')}</span>}
                          {t('memory.source', { source: e.source === 'human' ? t('memory.you') : e.source, date: e.updated.slice(0, 10) })}
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
