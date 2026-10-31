import { useLocale } from '../../i18n/LocaleContext';
import { WORKLOG_WINDOW_SIZE, type WorklogWindow } from './worklog-window';

export default function WorklogPager({ page, select }: {
  page: WorklogWindow<unknown>;
  select(end: number | null): void;
}) {
  const { locale } = useLocale();
  if (page.total <= WORKLOG_WINDOW_SIZE) return null;
  const english = locale === 'en-US';
  return <nav className="worklog-pager" aria-label={english ? 'Execution records' : '执行记录'}
    style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 12px', fontSize: 'var(--text-xs)' }}>
    <span style={{ color: 'var(--color-text-tertiary)', marginRight: 'auto' }}>
      {english ? 'Records' : '记录'} {page.start + 1}–{page.end} / {page.total}
    </span>
    <button type="button" className="monsoon-turn__worklog-toggle" disabled={page.previousEnd === null}
      onClick={() => select(page.previousEnd)}>{english ? 'Previous' : '上一段'}</button>
    <button type="button" className="monsoon-turn__worklog-toggle" disabled={page.nextEnd === null}
      onClick={() => select(page.nextEnd === page.total ? null : page.nextEnd)}>{english ? 'Next' : '下一段'}</button>
    {!page.followingLatest && <button type="button" className="monsoon-turn__worklog-toggle"
      onClick={() => select(null)}>{english ? 'Latest' : '回到最新'}</button>}
  </nav>;
}
