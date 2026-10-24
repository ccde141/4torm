import BoundedText from '../../engine/text-display/BoundedText';
import { useLocale } from '../../i18n/LocaleContext';
import './tool-record-details.css';

/** Generic disclosure for specialized cards; all fields come from the original tool record. */
export default function ToolRecordDetails({ params, result }: {
  params?: Record<string, unknown>; result?: string;
}) {
  const { t, locale } = useLocale();
  return <details className="tool-record-details">
    <summary>{locale === 'en-US' ? 'Parameters and result' : '参数与结果'}</summary>
    {params && Object.keys(params).length > 0 && <section><small>{t('chat.tool.params')}</small>
      <pre><BoundedText text={JSON.stringify(params, null, 2)} /></pre></section>}
    {result !== undefined && <section><small>{t('chat.tool.result')}</small>
      <pre><BoundedText text={result} /></pre></section>}
  </details>;
}
