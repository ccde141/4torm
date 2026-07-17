export default function SeatEditorLoading({ error, onRetry, onCancel }: {
  error?: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="cyclone__seat-editor-scroll">
      <section className="cyclone__seat-editor mo-enter-fade-up" aria-live="polite">
        <h2 className="cyclone__seat-editor-title">工位设置</h2>
        {error ? (
          <>
            <p className="cyclone__seat-editor-error">{error}</p>
            <div className="cyclone__seat-editor-actions">
              <button type="button" className="primary-cta-btn" onClick={onRetry}>重新加载</button>
              <button type="button" className="secondary-action-btn" onClick={onCancel}>取消</button>
            </div>
          </>
        ) : (
          <div className="cyclone__seat-editor-loading">正在加载工位设置…</div>
        )}
      </section>
    </div>
  );
}
