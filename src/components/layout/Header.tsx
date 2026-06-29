import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { loadSkinConfig } from '../../store/skin';
import { getAgents } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import SkinPanel from './SkinPanel';
import '../../styles/components/header.css';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onNavigate?: (page: string, sessionId?: string) => void;
}

type SearchType = 'agent' | 'session' | 'cyclone' | 'tradewind' | 'tide' | 'convection';

interface SearchResult {
  type: SearchType;
  id: string;
  label: string;
  sublabel: string;
}

// 各结果类型 → 落地页面 id（季风会话另走 deep-link，见 handleResultClick）
const TYPE_PAGE: Record<SearchType, string> = {
  agent: 'agent', session: 'chat', cyclone: 'cyclone',
  tradewind: 'tradewind', tide: 'tide', convection: 'convection',
};

// 结果右侧徽标文案
const TYPE_BADGE: Record<SearchType, string> = {
  agent: 'Agent', session: '季风', cyclone: '工作室',
  tradewind: '工作流', tide: '潮汐', convection: '会议室',
};

const Header = memo(function Header({ title, subtitle, onNavigate }: HeaderProps) {
  const [skinOpen, setSkinOpen] = useState(false);
  const skinBtnRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    // 单个数据源失败不应拖垮整次搜索，故各 fetch 独立 try/catch（getJson 返回 null 时跳过）
    const getJson = async (url: string): Promise<any> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    };

    const [agents, sessions, cyclones, tradewinds, tides, convections] = await Promise.all([
      getAgents(),
      getAllSessions(),
      getJson('/api/cyclone/list'),
      getJson('/api/tradewind/workflow/list'),
      getJson('/api/tide/tasks'),
      getJson('/api/convection/list'),
    ]);

    const hit = (...fields: (string | undefined)[]) =>
      fields.some(f => f && f.toLowerCase().includes(lower));

    const agentResults: SearchResult[] = agents
      .filter(a => hit(a.name, a.role, a.description))
      .map(a => ({ type: 'agent', id: a.id, label: a.name, sublabel: a.role }));

    const sessionResults: SearchResult[] = sessions
      .filter(s => hit(s.title, s.agentName))
      .map(s => ({ type: 'session', id: s.id, label: s.title, sublabel: s.agentName || '' }));

    // 工作室（气旋）：列表为 WorkshopSummary[]，按标题匹配
    const cycloneResults: SearchResult[] = (Array.isArray(cyclones) ? cyclones : [])
      .filter((w: any) => hit(w.title))
      .map((w: any) => ({ type: 'cyclone', id: w.id, label: w.title || '未命名工作室', sublabel: `${w.seatCount ?? 0} 工位 · ${w.roomCount ?? 0} 群聊` }));

    // 工作流（信风）：{ workflows: [{ workflowId, name, nodeCount }] }
    const tradewindResults: SearchResult[] = (Array.isArray(tradewinds?.workflows) ? tradewinds.workflows : [])
      .filter((w: any) => hit(w.name))
      .map((w: any) => ({ type: 'tradewind', id: w.workflowId, label: w.name || '未命名工作流', sublabel: `${w.nodeCount ?? 0} 节点` }));

    // 潮汐：TideTask[]，按任务名 + prompt 匹配
    const tideResults: SearchResult[] = (Array.isArray(tides) ? tides : [])
      .filter((t: any) => hit(t.name, t.prompt))
      .map((t: any) => ({ type: 'tide', id: t.id, label: t.name || '未命名任务', sublabel: t.schedule || '' }));

    // 会议室（对流）：ConvectionSessionSummary[]，按标题 + 议题匹配
    const convectionResults: SearchResult[] = (Array.isArray(convections) ? convections : [])
      .filter((c: any) => hit(c.title, c.topic))
      .map((c: any) => ({ type: 'convection', id: c.id, label: c.title || '未命名会议', sublabel: c.topic || '' }));

    setResults([
      ...agentResults, ...sessionResults, ...cycloneResults,
      ...tradewindResults, ...tideResults, ...convectionResults,
    ]);
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
    // 季风会话支持 deep-link 到具体会话；其余功能页暂只跳转到页面（不支持条目级定位）
    if (r.type === 'session') {
      onNavigate?.('chat', r.id);
    } else {
      onNavigate?.(TYPE_PAGE[r.type]);
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
            placeholder="搜索 Agent、季风、工作室、潮汐…"
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
                    <span className="header__search-item-type">{TYPE_BADGE[r.type]}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <a
          className="header__btn"
          href="/docs/"
          target="_blank"
          rel="noopener noreferrer"
          title="使用文档"
          aria-label="使用文档"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </a>
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