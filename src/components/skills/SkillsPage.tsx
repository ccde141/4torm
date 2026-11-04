import SkillCategoryPicker from './SkillCategoryPicker';
import { skillCategory } from './skill-category';
import { useState, useEffect, useRef } from 'react';
import { listSkills, readSkillFile, readSkillToolDefs, createSkill, deleteSkill, changeSkillCategory } from '../../store/skills';
import type { SkillMeta } from '../../types';
import { useActiveCapabilityList } from '../capabilities/useActiveCapabilityList';
import '../../styles/components/capability-management.css';
import '../../styles/components/skills.css';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirm } from '../common/ConfirmDialog';

export default function SkillsPage({ active }: { active: boolean }) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const { items: skills, loadError, refresh } = useActiveCapabilityList(active, listSkills);
  const [preview, setPreview] = useState<{ meta: SkillMeta; content: string; tools: Array<{ name: string; description: string }> | null } | null>(null);
  const [query, setQuery] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const groups = [...new Set(skills.map(skill => skillCategory(skill.category)))];
  const matches = skills.filter(skill => `${skill.name} ${skill.id} ${skill.description} ${skillCategory(skill.category)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const saveCategory = async (skill: SkillMeta, category: string): Promise<boolean> => {
    setSavingCategory(true);
    try { await changeSkillCategory(skill, category); setError(''); await refresh(); return true; }
    catch (error) { setError(t(error instanceof Error && error.message === 'SKILL_CATEGORY_CONFLICT' ? 'skills.category.conflict' : 'skills.category.failed')); return false; }
    finally { setSavingCategory(false); }
  };
  const [showCreate, setShowCreate] = useState(false);

  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState(() => t('skills.create.template'));
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletePending = useRef(false);

  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [preview]);

  const handlePreview = async (skill: SkillMeta) => {
    const [content, tools] = await Promise.all([
      readSkillFile(skill.id, 'SKILL.md').catch(() => null),
      skill.hasTools ? readSkillToolDefs(skill.id).catch(() => null) : null,
    ]);
    setPreview({ meta: skill, content: content || t('skills.preview.empty'), tools });
  };

  const handleDelete = async (skill: SkillMeta) => {
    if (deletePending.current) return;
    deletePending.current = true;
    try {
      if (!(await confirm({
        title: t('skills.delete.title', { name: skill.name }),
        message: t('skills.delete.message'),
        confirmText: t('skills.card.remove'), danger: true,
      }))) return;
      setDeletingId(skill.id);
      setError('');
      await deleteSkill(skill.id);
      if (preview?.meta.id === skill.id) setPreview(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('skills.delete.failed'));
    } finally {
      deletePending.current = false;
      setDeletingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newId.trim() || !newName.trim()) {
      setError(t('skills.create.required'));
      return;
    }
    const meta: SkillMeta = {
      id: newId.trim().toLowerCase().replace(/\s+/g, '-'),
      name: newName.trim(),
      description: newDesc.trim(),
      category: newCategory.trim(),
      version: '1.0.0',
      author: 'User',
      hasTools: false,
    };
    try {
      await createSkill(meta.id, meta, newContent);
      setNewId(''); setNewName(''); setNewDesc(''); setNewContent(t('skills.create.template'));
      setShowCreate(false);
      await refresh();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="capability-page skills-page">
      <div className="capability-header skills-header">
        <div className="capability-heading">
          <h2 className="capability-title">{t('skills.page.title')}</h2>
          <p className="capability-subtitle">{t('skills.page.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="capability-button capability-button--secondary" onClick={() => void refresh().catch(() => undefined)}>
            {t('skills.page.refresh')}
          </button>
          <button className={`capability-button ${showCreate ? 'capability-button--secondary' : 'capability-button--primary'}`} onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? t('skills.page.close') : t('skills.page.create')}
          </button>
        </div>
      </div>

      {(error || loadError) && <div className="capability-alert skills-error" role="alert">{error || loadError?.message}</div>}

      {showCreate && (
        <div className="capability-panel capability-panel--active skill-create-section">
          <h3>{t('skills.create.title')}</h3>
          <div className="capability-form skill-create-form">
            <div className="skill-create-row">
              <div style={{ flex: 1 }}>
                <label>{t('skills.create.id')}</label>
                <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="my-skill" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label>{t('skills.create.name')}</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('skills.create.namePlaceholder')} style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 0.6 }}>
                <label>{t('skills.create.category')}</label>
                <input list="skill-category-options" value={newCategory} maxLength={60} onChange={e => setNewCategory(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div>
              <label>{t('skills.create.description')}</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder={t('skills.create.descriptionPlaceholder')} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label>{t('skills.create.content')}</label>
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} rows={8} />
            </div>
            <button className="capability-button capability-button--primary skill-create-submit" onClick={handleCreate}>{t('skills.create.submit')}</button>
          </div>
        </div>
      )}

      <datalist id="skill-category-options">{groups.map(name => <option key={name} value={name} />)}</datalist>
      <div className="capability-form skills-search"><input type="search" aria-label={t('skills.search')} placeholder={t('skills.search')} value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="skills-grid" style={{ marginTop: showCreate ? 'var(--space-6)' : 0 }}>
        {skills.length === 0 && (
          <div className="capability-empty" style={{ gridColumn: '1 / -1' }}>
            {t('skills.empty.title')}<br />
            <span style={{ fontSize: 'var(--text-xs)' }}>{t('skills.empty.hint')}</span>
          </div>
        )}
        {groups.map(group => {
          const items = matches.filter(skill => skillCategory(skill.category) === group);
          return items.length > 0 && <details key={group} className="capability-panel skills-group" open>
            <summary className="skills-group__summary"><span aria-hidden="true">›</span><strong>{group || t('skills.category.unclassified')}</strong><span className="capability-badge">{items.length}</span></summary>
            <div className="capability-list skills-group__items">{items.map(skill => (
          <div key={skill.id} className="capability-panel capability-record skill-card">
            <div className="skill-card__header">
              <h4 className="skill-card__name">{skill.name}</h4>
              <span className="skill-card__id">{skill.id}</span>
              <SkillCategoryPicker skill={skill} skills={skills} disabled={savingCategory || deletingId !== null}
                onChange={category => saveCategory(skill, category)} />
            </div>
            <p className="skill-card__desc">{skill.description}</p>
            <div className="skill-card__meta">
              <span>{skill.version}</span>
              <span>{t('skills.card.author', { author: skill.author })}</span>
              {skill.hasTools && <span>{t('skills.card.hasTools')}</span>}
            </div>
            <div className="capability-actions skill-card__actions">
              <button className="capability-button capability-button--secondary skill-btn-preview" onClick={() => handlePreview(skill)}>{t('skills.card.preview')}</button>
              <button className="capability-button capability-button--danger skill-btn-delete" disabled={deletingId !== null || savingCategory} onClick={() => void handleDelete(skill)}>
                {deletingId === skill.id ? t('skills.delete.pending') : t('skills.card.remove')}
              </button>
            </div>
          </div>
        ))}</div></details>;
        })}
        {skills.length > 0 && matches.length === 0 && <div className="capability-empty">{t('skills.noResults')}</div>}
      </div>

      {preview && (
        <div className="skill-preview-overlay" role="dialog" aria-modal="true" aria-label={preview.meta.name} onClick={() => setPreview(null)}>
          <div className="capability-panel skill-preview-modal" onClick={e => e.stopPropagation()}>
            <h3>{preview.meta.name}</h3>
            <div className="skill-preview-meta">
              <span>ID: {preview.meta.id}</span>
              <span>v{preview.meta.version}</span>
              <span>{skillCategory(preview.meta.category) || t('skills.category.unclassified')}</span>
            </div>
            <div className="skill-preview-content">{preview.content}</div>
            {preview.tools && preview.tools.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>{t('skills.preview.tools', { count: preview.tools.length })}</div>
                {preview.tools.map((t, i) => (
                  <div key={i} style={{ padding: 'var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 'var(--font-semibold)' }}>{t.name}</span>
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)' }}>{t.description}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="capability-button capability-button--primary skill-preview-close" onClick={() => setPreview(null)}>{t('skills.preview.close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
