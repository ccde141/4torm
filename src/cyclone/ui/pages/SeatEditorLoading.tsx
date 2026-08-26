import { useLocale } from '../../../i18n/LocaleContext';

export default function SeatEditorLoading({ error, onRetry, onCancel }: {
  error?: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="cyclone__seat-editor-scroll">
      <section className="cyclone__seat-editor mo-enter-fade-up" aria-live="polite">
        <h2 className="cyclone__seat-editor-title">{t('cyclone.seat.settings')}</h2>
        {error ? (
          <>
            <p className="cyclone__seat-editor-error">{error}</p>
            <div className="cyclone__seat-editor-actions">
              <button type="button" className="primary-cta-btn" onClick={onRetry}>{t('cyclone.seat.reload')}</button>
              <button type="button" className="secondary-action-btn" onClick={onCancel}>{t('common.cancel')}</button>
            </div>
          </>
        ) : (
          <div className="cyclone__seat-editor-loading">{t('cyclone.seat.loading')}</div>
        )}
      </section>
    </div>
  );
}
