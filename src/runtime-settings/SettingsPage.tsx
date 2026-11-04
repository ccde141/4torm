import { useLocale } from '../i18n/LocaleContext';
import { useState } from 'react';
import { CompactionSettingsPanel } from './CompactionSettingsPanel';
import { MemoryRecallSettingsPanel } from './MemoryRecallSettingsPanel';
import './settings-page.css';

export default function RuntimeSettingsPage() {
  const { t } = useLocale();
  const [selected, setSelected] = useState<'recall' | 'compaction'>('recall');
  return <div className="runtime-settings-page">
    <div className="runtime-settings-workspace">
    <nav className="runtime-settings-navigator" aria-label={t('recall.settingsCategories')}>
      <div className="runtime-settings-navigator__title">{t('nav.settings')}</div>
      {(['recall', 'compaction'] as const).map(item => <button type="button" key={item}
        aria-current={selected === item ? 'page' : undefined} onClick={() => setSelected(item)}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d={item === 'recall' ? 'M12 4v16M8 5a3 3 0 0 0-5 3 4 4 0 0 0 0 7 3 3 0 0 0 5 4M16 5a3 3 0 0 1 5 3 4 4 0 0 1 0 7 3 3 0 0 1-5 4' : 'M4 5h16M7 9h10M7 15h10M4 19h16M10 11l2 2 2-2'} />
        </svg>
        <span><strong>{t(item === 'recall' ? 'recall.title' : 'compaction.title')}</strong>
          <small>{t(item === 'recall' ? 'recall.categoryHint' : 'recall.compactionCategoryHint')}</small></span>
      </button>)}
    </nav>
    <div className="runtime-settings-detail">
    <section className="runtime-settings-section" aria-labelledby="memory-recall-settings-title" hidden={selected !== 'recall'}>
      <header className="runtime-settings-section__header">
        <div className="runtime-settings-section__identity">
          <span className="runtime-settings-section__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v16M8 5a3 3 0 0 0-5 3 4 4 0 0 0 0 7 3 3 0 0 0 5 4M16 5a3 3 0 0 1 5 3 4 4 0 0 1 0 7 3 3 0 0 1-5 4M5 10h3m8 4h3" />
            </svg>
          </span>
          <div><h2 id="memory-recall-settings-title">{t('recall.title')}</h2><p>{t('recall.description')}</p></div>
        </div>
      </header>
      <MemoryRecallSettingsPanel />
    </section>
    <section className="runtime-settings-section" aria-labelledby="compaction-settings-title" hidden={selected !== 'compaction'}>
      <header className="runtime-settings-section__header">
        <div className="runtime-settings-section__identity">
          <span className="runtime-settings-section__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16M7 9h10M7 15h10M4 19h16M10 11l2 2 2-2" />
            </svg>
          </span>
          <div><h2 id="compaction-settings-title">{t('compaction.title')}</h2>
            <p>{t('compaction.description')}</p></div>
        </div>
        <span className="runtime-settings-section__scope">{t('compaction.scope')}</span>
      </header>
      <CompactionSettingsPanel />
    </section>
    </div></div>
  </div>;
}
