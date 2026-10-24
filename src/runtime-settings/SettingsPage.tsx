import { useLocale } from '../i18n/LocaleContext';
import { CompactionSettingsPanel } from './CompactionSettingsPanel';
import './settings-page.css';

export default function RuntimeSettingsPage() {
  const { t } = useLocale();
  return <div className="runtime-settings-page">
    <section className="runtime-settings-section" aria-labelledby="compaction-settings-title">
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
  </div>;
}
