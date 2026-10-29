import { backendUrl } from '../../lib/backend-client';
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { loadSkinConfig } from '../../store/skin';
import SkinPanel from './SkinPanel';
import { useLocale } from '../../i18n/LocaleContext';
import '../../styles/components/header.css';
import { readHeaderSearch, type SearchResult, type SearchType } from './header-search';
import { createLatestRequestGuard, type LatestRequest } from '../../lib/latest-request';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onNavigate?: (page: string, sessionId?: string) => void;
}

// 各结果类型 → 落地页面 id（季风会话另走 deep-link，见 handleResultClick）
const TYPE_PAGE: Record<SearchType, string> = {
  agent: 'agent', session: 'chat', cyclone: 'cyclone',
  tradewind: 'tradewind', tide: 'tide', convection: 'convection',
};

const Header = memo(function Header({ title, subtitle, onNavigate }: HeaderProps) {
  const { locale, t } = useLocale();
  const [skinOpen, setSkinOpen] = useState(false);
  const skinBtnRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const requests = useRef(createLatestRequestGuard());
  const controller = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadSkinConfig();
  }, []);

  const invalidateSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requests.current.cancel();
    controller.current?.abort();
    controller.current = null;
  }, []);

  const doSearch = useCallback(async (q: string, request: LatestRequest) => {
    if (!request.isCurrent()) return;
    const current = new AbortController();
    controller.current = current;
    try {
      const found = await readHeaderSearch(q, current.signal);
      if (!request.isCurrent()) return;
      setResults(found); setSearchFailed(false); setSearchPending(false); setShowResults(true);
    } catch {
      if (!request.isCurrent()) return;
      setResults([]); setSearchFailed(true); setSearchPending(false); setShowResults(true);
    } finally { if (controller.current === current) controller.current = null; }
  }, []);

  const scheduleSearch = useCallback((value: string) => {
    invalidateSearch();
    setResults([]); setShowResults(!!value.trim()); setSearchPending(!!value.trim()); setSearchFailed(false);
    if (!value.trim()) return;
    const request = requests.current.begin();
    timerRef.current = setTimeout(() => void doSearch(value, request), 200);
  }, [doSearch, invalidateSearch]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuery(value); scheduleSearch(value);
  }, [scheduleSearch]);

  useEffect(() => invalidateSearch, [invalidateSearch]);

  const handleResultClick = useCallback((r: SearchResult) => {
    invalidateSearch(); setResults([]); setSearchPending(false); setShowResults(false);
    setQuery('');
    // 季风会话支持 deep-link 到具体会话；其余功能页暂只跳转到页面（不支持条目级定位）
    if (r.type === 'session') {
      onNavigate?.('chat', r.id);
    } else {
      onNavigate?.(TYPE_PAGE[r.type]);
    }
  }, [onNavigate, invalidateSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        invalidateSearch(); setResults([]); setSearchPending(false); setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [invalidateSearch]);

  return (
    <header className="header">
      <div>
        <h1 className="header__title">{title}</h1>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>
      <div className="header__actions">
        <div className="header__search" ref={searchRef} aria-busy={searchPending}>
          <svg className="header__search-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="header__search-input"
            type="text"
            placeholder={t('header.search')}
            aria-label={t('header.searchLabel')}
            value={query}
            onChange={handleInputChange}
            onFocus={() => scheduleSearch(query)}
            onKeyDown={event => { if (event.key === 'Escape') { invalidateSearch(); setResults([]); setSearchPending(false); setShowResults(false); } }}
          />
          {showResults && (
            <div className="header__search-dropdown">
              {results.length === 0 ? (
                <div className="header__search-empty" role="status">{t(searchPending ? 'header.searching'
                  : searchFailed ? 'header.searchFailed' : 'header.noResults')}</div>
              ) : (
                results.map(r => (
                  <button
                    key={`${r.type}-${r.id}`}
                    className="header__search-item"
                    onClick={() => handleResultClick(r)}
                  >
                    <span className="header__search-item-icon">
                      {r.type === 'agent' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 5c0-1 .5-2 2-2h8c1.5 0 2 1 2 2" />
                          <path d="M6 5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                          <path d="M6 5v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      )}
                    </span>
                    <div className="header__search-item-text">
                      <span className="header__search-item-label">{r.label || t(`header.untitled.${r.type}`)}</span>
                      <span className="header__search-item-sublabel">{r.detail ? t(r.detail.key, r.detail.values) : r.sublabel}</span>
                    </div>
                    <span className="header__search-item-type">{t(`header.type.${r.type}`)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <a
          className="header__btn"
          href={backendUrl(locale === 'en-US' ? '/docs/en/' : '/docs/')}
          target="_blank"
          rel="noopener noreferrer"
          title={t('header.docs')}
          aria-label={t('header.docs')}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </a>
        <div className="header__skin-wrapper">
          <button
            ref={skinBtnRef}
            className={`header__btn${skinOpen ? ' header__btn--active' : ''}`}
            onClick={() => setSkinOpen(o => !o)}
            title={t('header.skin')}
            aria-label={t('header.skin')}
            aria-expanded={skinOpen}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 5c0-1 .5-2 2-2h8c1.5 0 2 1 2 2" />
              <path d="M6 5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <path d="M6 5v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5" />
              <path d="M10 12v4" />
              <path d="M14 12v4" />
            </svg>
          </button>
          {skinOpen && <SkinPanel onClose={() => setSkinOpen(false)} triggerRef={skinBtnRef} />}
        </div>
      </div>
    </header>
  );
});

export default Header;
