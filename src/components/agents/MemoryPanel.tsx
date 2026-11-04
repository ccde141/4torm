import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  listMemory, createMemory, updateMemory, deleteMemory,
  type MemoryEntry, type MemoryCategory, type MemoryDraft, type MemoryTier,
} from '../../api/memory';
import '../../styles/components/config-modal.css';
import '../../styles/components/memory-panel.css';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirm } from '../common/ConfirmDialog';

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
  embedded: true;
}

const EMPTY_DRAFT: MemoryDraft = { summary: '', detail: '', category: 'fact', tier: 'normal', tags: [] };
const entryTier = (entry: MemoryEntry): MemoryTier => entry.tier ?? (entry.category === 'feedback' ? 'frequent' : 'normal');

export default function MemoryPanel({ agentId, agentName }: Props) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const removingRef = useRef(false);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [category, setCategory] = useState<MemoryCategory | 'all'>('all');
  const [limit, setLimit] = useState(40);
  const loadGeneration = useRef(0);

  const reload = useCallback(() => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    return listMemory(agentId)
      .then(es => { if (generation === loadGeneration.current) { setEntries(es); setError(''); } })
      .catch(e => { if (generation === loadGeneration.current) setError(e.message); })
      .finally(() => { if (generation === loadGeneration.current) setLoading(false); });
  }, [agentId]);

  useEffect(() => {
    const generation = loadGeneration;
    void reload();
    return () => { generation.current++; };
  }, [reload]);
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(entry => ((entryTier(entry) === 'archived') === archived) && (category === 'all' || entry.category === category)
      && terms.every(term => `${entry.summary} ${entry.detail} ${entry.tags.join(' ')} ${entry.slug}`.toLocaleLowerCase().includes(term)))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }, [entries, query, archived, category]);

  const [showTags, setShowTags] = useState(false);

  const startEdit = (e: MemoryEntry) => {
    setCreating(false);
    setEditingSlug(e.slug);
    setDraft({ summary: e.summary, detail: e.detail, category: e.category, tier: entryTier(e), tags: [...e.tags], expectedUpdated: e.updated });
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
    if (removingRef.current || busy) return;
    const entry = entries.find(item => item.slug === slug);
    if (!entry) return;
    removingRef.current = true;
    try {
      if (!await confirm({ title: t('memory.deleteTitle', { name: entry.summary || entry.detail.slice(0, 80) }),
        message: t('memory.deleteMessage', { agent: agentName }), confirmText: t('common.delete'), danger: true })) return;
      setBusy(true);
      await deleteMemory(agentId, slug, entry.updated);
      reload();
    }
    catch (e) { setError((e as Error).message); }
    finally { removingRef.current = false; setBusy(false); }
  };

  const parseTags = (v: string) => setDraft(d => ({ ...d, tags: v.split(/[,，]/).map(t => t.trim()).filter(Boolean) }));
  const move = async (entry: MemoryEntry, value: MemoryTier) => {
    setBusy(true);
    try { await updateMemory(agentId, entry.slug, { tier: value, expectedUpdated: entry.updated }); await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const editor = (
    <div className="mem-editor">
      <label className="mem-label" htmlFor="memory-summary">{t('memory.summaryLabel')}</label>
      <input id="memory-summary" className="mem-input" value={draft.summary ?? ''}
        placeholder={t('memory.summaryPlaceholder')} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))} />
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
    <div className="agent-detail__memory-content">
        <div className="config-modal-body" style={{ overflowY: 'auto' }}>
          <div className="mem-overview">
            <div><h3>{t('memory.title')}</h3><p>{t('memory.libraryDescription')}</p></div>
            <div className="mem-overview-actions"><span className="mem-count">{entries.length}</span>
              <button type="button" className="mem-btn" disabled={busy || loading} onClick={() => void reload()}>{t('memory.refresh')}</button></div>
          </div>
          <div className="mem-search-row">
            <input type="search" className="mem-input" value={query} aria-label={t('memory.search')}
              placeholder={t('memory.search')} onChange={e => { setQuery(e.target.value); setLimit(40); }} />
            <select className="mem-select" value={category} aria-label={t('memory.category')}
              onChange={e => { setCategory(e.target.value as MemoryCategory | 'all'); setLimit(40); }}>
              <option value="all">{t('memory.allCategories')}</option>
              {CATEGORIES.map(value => <option key={value} value={value}>{t(CATEGORY_META[value].label)}</option>)}
            </select>
            <button type="button" className="mem-btn mem-archive-filter" aria-pressed={archived}
              onClick={() => { setArchived(value => !value); setLimit(40); }}>
              {t('memory.archived')} <span>{entries.filter(entry => entryTier(entry) === 'archived').length}</span>
            </button>
          </div>
          <p className="mem-hint mem-results">{t('memory.resultCount', { count: filtered.length })} · {t(archived ? 'memory.archivedHint' : 'memory.allHint')}</p>
          {error && <div className="mem-error">{error}</div>}

          {creating ? editor : (
            <button className="mem-btn mem-btn--add" onClick={startCreate}>{t('memory.add')}</button>
          )}

          {loading && entries.length === 0 ? (
            <div className="mem-empty">{t('common.loading')}</div>
          ) : entries.length === 0 && !creating ? (
            <div className="mem-empty">{t('memory.empty')}</div>
          ) : (
            <ul className="mem-list">
              {filtered.slice(0, limit).map(e => (
                <li key={e.slug} className="mem-item">
                  {editingSlug === e.slug ? editor : (
                    <>
                      <div className="mem-item-head">
                        <span className="mem-badge" style={{ background: `${CATEGORY_META[e.category].color}22`, color: CATEGORY_META[e.category].color }}>
                          {t(CATEGORY_META[e.category].label)}
                        </span>
                        <span className="mem-actions">
                          <button className="mem-icon-btn" title={t('common.edit')} aria-label={t('memory.editLabel')} onClick={() => startEdit(e)}>✎</button>
                          <button className="mem-icon-btn mem-icon-btn--danger" disabled={busy} title={t('common.delete')} aria-label={t('memory.deleteLabel')} onClick={() => void remove(e.slug)}>🗑</button>
                        </span>
                      </div>
                      <details className="mem-content"><summary className="mem-summary">{e.summary || e.detail.slice(0, 80)}</summary>
                        <p className="mem-detail">{e.detail}</p></details>
                      <div className="mem-foot">
                        <button type="button" className="mem-btn mem-btn--archive" disabled={busy}
                          onClick={() => void move(e, entryTier(e) === 'archived' ? 'normal' : 'archived')}>
                          {t(entryTier(e) === 'archived' ? 'memory.restore' : 'memory.archive')}
                        </button>
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
          {!loading && entries.length > 0 && filtered.length === 0 && <div className="mem-empty">{t('memory.noResults')}</div>}
          {!loading && filtered.length > limit && <button type="button" className="mem-btn mem-btn--add" onClick={() => setLimit(n => n + 40)}>{t('memory.showMore')}</button>}
        </div>
    </div>
  );
}
