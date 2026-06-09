import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { loadSkinConfig } from '../../store/skin';
import { getAgents } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import type { Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import SkinPanel from './SkinPanel';
import '../../styles/components/header.css';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onNavigate?: (page: string, sessionId?: string) => void;
}

interface SearchResult {
  type: 'agent' | 'session';
  id: string;
  label: string;
  sublabel: string;
}

const Header = memo(function Header({ title, subtitle, onNavigate }: HeaderProps) {
  const [skinOpen, setSkinOpen] = useState(false);
  const skinBtnRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    loadSkinConfig();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    const lower = q.toLowerCase();
    const [agents, sessions] = await Promise.all([getAgents(), getAllSessions()]);

    const agentResults: SearchResult[] = agents
      .filter(a => a.name.toLowerCase().includes(lower) || a.role.toLowerCase().includes(lower) || a.description.toLowerCase().includes(lower))
      .map(a => ({ type: 'agent', id: a.id, label: a.name, sublabel: a.role }));

    const sessionResults: SearchResult[] = sessions
      .filter(s => s.title.toLowerCase().includes(lower) || (s.agentName && s.agentName.toLowerCase().includes(lower)))
      .map(s => ({ type: 'session', id: s.id, label: s.title, sublabel: s.agentName || '' }));

    setResults([...agentResults, ...sessionResults]);
    setShowResults(true);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 200);
  }, [doSearch]);

  const handleResultClick = useCallback((r: SearchResult) => {
    setShowResults(false);
    setQuery('');
    if (r.type === 'agent') {
      onNavigate?.('agent');
    } else {
      onNavigate?.('chat', r.id);
    }
  }, [onNavigate]);

  useEffect(() => {
    if (!showResults) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [showResults]);

  return (
    <header className="header">
      <div>
        <h1 className="header__title">{title}</h1>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>
      <div className="header__actions">
        <div className="header__search" ref={searchRef}>
          <svg className="header__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="header__search-input"
            type="text"
            placeholder="搜索 Agent、会话..."
            aria-label="搜索"
            value={query}
            onChange={handleInputChange}
            onFocus={() => results.length > 0 && setShowResults(true)}
          />
          {showResults && (
            <div className="header__search-dropdown">
              {results.length === 0 ? (
                <div className="header__search-empty">未找到结果</div>
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
                      <span className="header__search-item-label">{r.label}</span>
                      <span className="header__search-item-sublabel">{r.sublabel}</span>
                    </div>
                    <span className="header__search-item-type">{r.type === 'agent' ? 'Agent' : '会话'}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="header__skin-wrapper">
          <button
            ref={skinBtnRef}
            className={`header__btn${skinOpen ? ' header__btn--active' : ''}`}
            onClick={() => setSkinOpen(o => !o)}
            title="Skin"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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