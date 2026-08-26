import { useLocale } from '../../i18n/LocaleContext';

export default function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="sidebar__language" role="group" aria-label={t('locale.label')}>
      <span className="sidebar__language-label">{t('locale.label')}</span>
      <div className="sidebar__language-options">
        <button
          type="button"
          className={locale === 'zh-CN' ? 'is-active' : ''}
          aria-pressed={locale === 'zh-CN'}
          onClick={() => setLocale('zh-CN')}
        >
          {t('locale.zh')}
        </button>
        <button
          type="button"
          className={locale === 'en-US' ? 'is-active' : ''}
          aria-pressed={locale === 'en-US'}
          onClick={() => setLocale('en-US')}
        >
          {t('locale.en')}
        </button>
      </div>
    </div>
  );
}
