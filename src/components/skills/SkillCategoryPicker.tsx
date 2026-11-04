import { useEffect, useId, useRef, useState } from 'react';
import type { SkillMeta } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import { skillCategory } from './skill-category';

interface Props {
  skill: SkillMeta;
  skills: SkillMeta[];
  disabled: boolean;
  onChange: (category: string) => Promise<boolean>;
}

export default function SkillCategoryPicker({ skill, skills, disabled, onChange }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = skillCategory(skill.category);
  const names = [...new Set(['', ...skills.map(item => skillCategory(item.category))])];
  const name = query.trim();
  const label = (category: string) => category || t('skills.category.unclassified');

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setShowContent(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, showContent]);

  const select = async (category: string) => {
    if (saving || disabled) return;
    if (category === current) { setOpen(false); trigger.current?.focus(); return; }
    setSaving(true);
    try { if (await onChange(category)) setOpen(false); }
    finally { setSaving(false); }
  };

  return <div className="skill-category-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="capability-button capability-button--secondary skill-category-trigger"
      aria-label={t('skills.category.select', { name: skill.name })} aria-expanded={open} aria-controls={id}
      disabled={disabled || saving} onClick={() => { setQuery(''); setShowContent(true); setOpen(value => !value); }}>
      {saving ? t('skills.category.saving') : label(current)} <span aria-hidden="true">⌄</span>
    </button>
    <div id={id} className={`skill-category-menu${open ? ' is-open' : ''}`} inert={!open}
      role="group" aria-label={t('skills.create.category')} aria-busy={saving}>
      {showContent && <div className="skill-category-menu__inner capability-form">
        <input ref={input} aria-label={t('skills.category.search')} placeholder={t('skills.category.search')}
          value={query} maxLength={60} disabled={saving} onChange={event => setQuery(event.target.value)} />
        <div className="skill-category-options">
          {names.filter(category => label(category).toLocaleLowerCase().includes(name.toLocaleLowerCase())).map(category =>
            <button key={category} type="button" className="skill-category-option" aria-pressed={category === current}
              disabled={saving || disabled} onClick={() => void select(category)}>
              <span aria-hidden="true">{category === current ? '✓' : ''}</span><span>{label(category)}</span>
              <small>{skills.filter(item => skillCategory(item.category) === category).length}</small>
            </button>)}
          {name && !names.includes(name) && <button type="button" className="skill-category-option skill-category-option--new"
            disabled={saving || disabled} onClick={() => void select(name)}>
            <span aria-hidden="true">＋</span><span>{t('skills.category.createMove', { name })}</span>
          </button>}
        </div>
      </div>}
    </div>
  </div>;
}
